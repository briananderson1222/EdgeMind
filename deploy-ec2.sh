#!/bin/bash
# EdgeMind EC2 Deployment Script
# Run this from your local machine with AWS CLI configured

set -e

# Configuration
INSTANCE_TYPE="t3.small"
KEY_NAME="edgemind-demo"
SECURITY_GROUP_NAME="edgemind-demo-sg"
INSTANCE_NAME="edgemind-demo"
REGION="us-east-1"
AWS_PROFILE="reply"

echo "🚀 Deploying EdgeMind to EC2..."

# Get default VPC ID
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query 'Vpcs[0].VpcId' --output text --profile $AWS_PROFILE --region $REGION)
echo "📦 Using VPC: $VPC_ID"

# Get a public subnet
SUBNET_ID=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=map-public-ip-on-launch,Values=true" --query 'Subnets[0].SubnetId' --output text --profile $AWS_PROFILE --region $REGION)
echo "📦 Using Subnet: $SUBNET_ID"

# Create security group if it doesn't exist
SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$SECURITY_GROUP_NAME" "Name=vpc-id,Values=$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text --profile $AWS_PROFILE --region $REGION 2>/dev/null || echo "None")

if [ "$SG_ID" == "None" ] || [ -z "$SG_ID" ]; then
    echo "🔒 Creating security group..."
    SG_ID=$(aws ec2 create-security-group \
        --group-name $SECURITY_GROUP_NAME \
        --description "EdgeMind demo security group" \
        --vpc-id $VPC_ID \
        --query 'GroupId' \
        --output text \
        --profile $AWS_PROFILE \
        --region $REGION)

    # Allow SSH
    aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22 --cidr 0.0.0.0/0 --profile $AWS_PROFILE --region $REGION
    # Allow HTTP (backend)
    aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 3000 --cidr 0.0.0.0/0 --profile $AWS_PROFILE --region $REGION
    # Allow InfluxDB (optional, for debugging)
    aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 8086 --cidr 0.0.0.0/0 --profile $AWS_PROFILE --region $REGION
fi
echo "🔒 Using Security Group: $SG_ID"

# Create key pair if it doesn't exist
if ! aws ec2 describe-key-pairs --key-names $KEY_NAME --profile $AWS_PROFILE --region $REGION &>/dev/null; then
    echo "🔑 Creating key pair..."
    aws ec2 create-key-pair --key-name $KEY_NAME --query 'KeyMaterial' --output text --profile $AWS_PROFILE --region $REGION > ~/.ssh/${KEY_NAME}.pem
    chmod 400 ~/.ssh/${KEY_NAME}.pem
    echo "🔑 Key saved to ~/.ssh/${KEY_NAME}.pem"
fi

# Get latest Amazon Linux 2023 AMI
AMI_ID=$(aws ec2 describe-images \
    --owners amazon \
    --filters "Name=name,Values=al2023-ami-2023*-x86_64" "Name=state,Values=available" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
    --output text \
    --profile $AWS_PROFILE \
    --region $REGION)
echo "📀 Using AMI: $AMI_ID"

# Create user-data script
USER_DATA=$(cat <<'EOF'
#!/bin/bash
set -ex

# Install Docker
dnf update -y
dnf install -y docker git
systemctl start docker
systemctl enable docker
usermod -aG docker ec2-user

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Clone the repository
cd /home/ec2-user
git clone https://github.com/YOUR_REPO/EdgeMind.git app || {
    # If no git repo, create minimal setup
    mkdir -p app
    cd app

    # Create docker-compose.yml
    cat > docker-compose.yml <<'COMPOSE'
version: '3.8'

services:
  influxdb:
    image: influxdb:2.7
    container_name: influxdb
    ports:
      - "8086:8086"
    environment:
      - DOCKER_INFLUXDB_INIT_MODE=setup
      - DOCKER_INFLUXDB_INIT_USERNAME=admin
      - DOCKER_INFLUXDB_INIT_PASSWORD=proveit2026
      - DOCKER_INFLUXDB_INIT_ORG=proveit
      - DOCKER_INFLUXDB_INIT_BUCKET=factory
      - DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=proveit-factory-token-2026
    volumes:
      - influxdb-data:/var/lib/influxdb2
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8086/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  backend:
    image: 718815871498.dkr.ecr.us-east-1.amazonaws.com/edgemind-prod-backend:latest
    container_name: edgemind-backend
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - NODE_ENV=production
      - AWS_REGION=us-east-1
      - MQTT_HOST=mqtt://virtualfactory.proveit.services:1883
      - MQTT_USERNAME=proveitreadonly
      - MQTT_PASSWORD=
      - INFLUXDB_URL=http://influxdb:8086
      - INFLUXDB_TOKEN=proveit-factory-token-2026
      - INFLUXDB_ORG=proveit
      - INFLUXDB_BUCKET=factory
    depends_on:
      influxdb:
        condition: service_healthy
    restart: unless-stopped

volumes:
  influxdb-data:
COMPOSE
}

# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 718815871498.dkr.ecr.us-east-1.amazonaws.com

# Start services
cd /home/ec2-user/app
docker-compose pull
docker-compose up -d

# Create systemd service for auto-start
cat > /etc/systemd/system/edgemind.service <<'SERVICE'
[Unit]
Description=EdgeMind Factory Dashboard
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ec2-user/app
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down

[Install]
WantedBy=multi-user.target
SERVICE

systemctl enable edgemind.service

echo "EdgeMind deployment complete!" > /home/ec2-user/deployment.log
EOF
)

# Create IAM role for EC2 to access ECR
ROLE_NAME="edgemind-ec2-role"
INSTANCE_PROFILE_NAME="edgemind-ec2-profile"

# Check if role exists
if ! aws iam get-role --role-name $ROLE_NAME --profile $AWS_PROFILE &>/dev/null; then
    echo "👤 Creating IAM role..."

    # Create trust policy
    cat > /tmp/trust-policy.json <<'TRUST'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": "ec2.amazonaws.com"
            },
            "Action": "sts:AssumeRole"
        }
    ]
}
TRUST

    aws iam create-role --role-name $ROLE_NAME --assume-role-policy-document file:///tmp/trust-policy.json --profile $AWS_PROFILE
    aws iam attach-role-policy --role-name $ROLE_NAME --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly --profile $AWS_PROFILE
    aws iam attach-role-policy --role-name $ROLE_NAME --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess --profile $AWS_PROFILE

    # Create instance profile
    aws iam create-instance-profile --instance-profile-name $INSTANCE_PROFILE_NAME --profile $AWS_PROFILE
    aws iam add-role-to-instance-profile --instance-profile-name $INSTANCE_PROFILE_NAME --role-name $ROLE_NAME --profile $AWS_PROFILE

    echo "⏳ Waiting for IAM profile to propagate..."
    sleep 10
fi

# Launch EC2 instance
echo "🚀 Launching EC2 instance..."
INSTANCE_ID=$(aws ec2 run-instances \
    --image-id $AMI_ID \
    --instance-type $INSTANCE_TYPE \
    --key-name $KEY_NAME \
    --security-group-ids $SG_ID \
    --subnet-id $SUBNET_ID \
    --iam-instance-profile Name=$INSTANCE_PROFILE_NAME \
    --user-data "$USER_DATA" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
    --query 'Instances[0].InstanceId' \
    --output text \
    --profile $AWS_PROFILE \
    --region $REGION)

echo "⏳ Waiting for instance to start..."
aws ec2 wait instance-running --instance-ids $INSTANCE_ID --profile $AWS_PROFILE --region $REGION

# Get public IP
PUBLIC_IP=$(aws ec2 describe-instances \
    --instance-ids $INSTANCE_ID \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text \
    --profile $AWS_PROFILE \
    --region $REGION)

echo ""
echo "✅ EdgeMind deployed successfully!"
echo ""
echo "📍 Instance ID: $INSTANCE_ID"
echo "🌐 Public IP: $PUBLIC_IP"
echo ""
echo "🔗 Access URLs (wait ~3-5 minutes for startup):"
echo "   Backend API: http://$PUBLIC_IP:3000"
echo "   Health Check: http://$PUBLIC_IP:3000/health"
echo "   WebSocket: ws://$PUBLIC_IP:3000/ws"
echo "   InfluxDB: http://$PUBLIC_IP:8086"
echo ""
echo "🔑 SSH Access:"
echo "   ssh -i ~/.ssh/${KEY_NAME}.pem ec2-user@$PUBLIC_IP"
echo ""
echo "📋 Check logs:"
echo "   ssh -i ~/.ssh/${KEY_NAME}.pem ec2-user@$PUBLIC_IP 'docker-compose -f /home/ec2-user/app/docker-compose.yml logs -f'"
