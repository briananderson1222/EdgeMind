from aws_cdk import (
    Stack,
    aws_s3 as s3,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_s3_deployment as s3_deployment,
    aws_elasticloadbalancingv2 as elbv2,
    aws_iam as iam,
    CfnOutput,
    Duration,
    RemovalPolicy,
)
from constructs import Construct


class FrontendStack(Stack):
    """S3 bucket and CloudFront distribution for frontend static files.

    Uses Origin Access Control (OAC) instead of deprecated OAI for S3 access.
    Includes WebSocket support with proper Sec-WebSocket-* header forwarding.
    """

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        alb: elbv2.IApplicationLoadBalancer,
        project_name: str = "edgemind",
        environment: str = "prod",
        resource_suffix: str = "",
        **kwargs
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Build resource name prefix
        name_prefix = f"{project_name}-{environment}"
        # Bucket name prefix: use suffix if provided, otherwise just name_prefix
        bucket_name_prefix = f"{name_prefix}-{resource_suffix}" if resource_suffix else name_prefix

        # S3 bucket for frontend static files
        self.frontend_bucket = s3.Bucket(
            self, "FrontendBucket",
            bucket_name=f"{bucket_name_prefix}-frontend",
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,  # Clean up on stack delete
            versioned=True,
            lifecycle_rules=[
                s3.LifecycleRule(
                    enabled=True,
                    noncurrent_version_expiration=Duration.days(30)
                )
            ]
        )

        # Cache Policy for static assets (aggressive caching)
        static_cache_policy = cloudfront.CachePolicy(
            self, "StaticCachePolicy",
            cache_policy_name=f"{name_prefix}-static-cache",
            comment="Cache policy for static frontend assets",
            default_ttl=Duration.days(1),
            max_ttl=Duration.days(365),
            min_ttl=Duration.seconds(0),
            cookie_behavior=cloudfront.CacheCookieBehavior.none(),
            header_behavior=cloudfront.CacheHeaderBehavior.none(),
            query_string_behavior=cloudfront.CacheQueryStringBehavior.none(),
            enable_accept_encoding_gzip=True,
            enable_accept_encoding_brotli=True,
        )

        # Cache Policy for API (no caching)
        api_cache_policy = cloudfront.CachePolicy(
            self, "APICachePolicy",
            cache_policy_name=f"{name_prefix}-api-cache",
            comment="No-cache policy for API requests",
            default_ttl=Duration.seconds(0),
            max_ttl=Duration.seconds(1),
            min_ttl=Duration.seconds(0),
            cookie_behavior=cloudfront.CacheCookieBehavior.all(),
            header_behavior=cloudfront.CacheHeaderBehavior.allow_list(
                "Host",
                "CloudFront-Forwarded-Proto",
                "CloudFront-Is-Desktop-Viewer",
                "CloudFront-Is-Mobile-Viewer",
                "CloudFront-Is-Tablet-Viewer",
            ),
            query_string_behavior=cloudfront.CacheQueryStringBehavior.all(),
        )

        # Origin Request Policy for API (forward essential headers)
        api_origin_request_policy = cloudfront.OriginRequestPolicy(
            self, "APIOriginRequestPolicy",
            origin_request_policy_name=f"{name_prefix}-api",
            comment="Forward essential headers for API requests",
            cookie_behavior=cloudfront.OriginRequestCookieBehavior.all(),
            header_behavior=cloudfront.OriginRequestHeaderBehavior.allow_list(
                "Host",
                "Origin",
                "Accept",
                "Accept-Language",
                "Content-Type",
            ),
            query_string_behavior=cloudfront.OriginRequestQueryStringBehavior.all(),
        )

        # Origin Request Policy for WebSocket - forward Sec-WebSocket-* headers
        # CRITICAL: These headers are required for WebSocket upgrade handshake
        websocket_origin_request_policy = cloudfront.OriginRequestPolicy(
            self, "WebSocketOriginRequestPolicy",
            origin_request_policy_name=f"{name_prefix}-websocket",
            comment="Forward WebSocket headers for connection upgrade",
            cookie_behavior=cloudfront.OriginRequestCookieBehavior.all(),
            header_behavior=cloudfront.OriginRequestHeaderBehavior.allow_list(
                # Required WebSocket headers - CloudFront auto-handles Connection/Upgrade
                "Sec-WebSocket-Key",
                "Sec-WebSocket-Version",
                "Sec-WebSocket-Protocol",
                "Sec-WebSocket-Accept",
                "Sec-WebSocket-Extensions",
                # Standard headers (Connection/Upgrade are hop-by-hop, handled by CloudFront)
                "Origin",
            ),
            query_string_behavior=cloudfront.OriginRequestQueryStringBehavior.all(),
        )

        # CloudFront logs bucket (must be created before distribution)
        log_bucket = s3.Bucket(
            self, "CloudFrontLogBucket",
            bucket_name=f"{bucket_name_prefix}-cloudfront-logs",
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            object_ownership=s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
            lifecycle_rules=[
                s3.LifecycleRule(
                    enabled=True,
                    expiration=Duration.days(90)
                )
            ]
        )

        # S3 Origin with Origin Access Control (OAC) - replacing deprecated OAI
        s3_origin = origins.S3BucketOrigin.with_origin_access_control(
            self.frontend_bucket,
            origin_access_levels=[cloudfront.AccessLevel.READ],
        )

        # ALB Origin for backend API and WebSocket
        # Custom header for origin verification - ALB rejects requests without it
        alb_origin = origins.LoadBalancerV2Origin(
            alb,
            protocol_policy=cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            http_port=80,
            connection_attempts=3,
            connection_timeout=Duration.seconds(10),
            read_timeout=Duration.seconds(60),  # Increased for WebSocket
            custom_headers={
                "X-Origin-Verify": "edgemind-cloudfront-origin-2026"
            }
        )

        # CloudFront Distribution
        self.distribution = cloudfront.Distribution(
            self, "FrontendDistribution",
            comment=f"{project_name} {environment} frontend distribution",
            default_root_object="index.html",
            default_behavior=cloudfront.BehaviorOptions(
                origin=s3_origin,
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=static_cache_policy,
                allowed_methods=cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                compress=True,
            ),
            additional_behaviors={
                # WebSocket connections - CRITICAL: Must forward Sec-WebSocket-* headers
                # Need both /ws and /ws/* because CloudFront patterns are exact
                "/ws": cloudfront.BehaviorOptions(
                    origin=alb_origin,
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
                    cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
                    origin_request_policy=websocket_origin_request_policy,
                    allowed_methods=cloudfront.AllowedMethods.ALLOW_ALL,
                    compress=False,
                ),
                "/ws/*": cloudfront.BehaviorOptions(
                    origin=alb_origin,
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
                    cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
                    origin_request_policy=websocket_origin_request_policy,
                    allowed_methods=cloudfront.AllowedMethods.ALLOW_ALL,
                    compress=False,
                ),
                # API requests go to ALB (no caching)
                "/api/*": cloudfront.BehaviorOptions(
                    origin=alb_origin,
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
                    origin_request_policy=api_origin_request_policy,
                    allowed_methods=cloudfront.AllowedMethods.ALLOW_ALL,
                    compress=False,
                ),
                # Health check endpoint
                "/health": cloudfront.BehaviorOptions(
                    origin=alb_origin,
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.ALLOW_ALL,
                    cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
                    allowed_methods=cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                ),
            },
            price_class=cloudfront.PriceClass.PRICE_CLASS_100,  # US, Canada, Europe only
            enable_logging=True,
            log_bucket=log_bucket,
            log_file_prefix="cloudfront/",
        )

        # Deploy frontend files to S3 (optional - uncomment if you want automatic deployment)
        # NOTE: This will deploy files from ../frontend/ directory
        # s3_deployment.BucketDeployment(
        #     self, "FrontendDeployment",
        #     sources=[s3_deployment.Source.asset("../")],  # Path to frontend files
        #     destination_bucket=self.frontend_bucket,
        #     distribution=self.distribution,
        #     distribution_paths=["/*"],
        #     prune=True,  # Remove files not in source
        #     exclude=["node_modules/*", ".git/*", ".env*", "infra/*"],
        #     include=["*.html", "*.js", "*.css", "*.png", "*.jpg", "*.svg"],
        # )

        # Outputs
        CfnOutput(
            self, "FrontendBucketName",
            value=self.frontend_bucket.bucket_name,
            description="Frontend S3 Bucket Name",
            export_name=f"{project_name}-{environment}-frontend-bucket"
        )

        CfnOutput(
            self, "FrontendBucketArn",
            value=self.frontend_bucket.bucket_arn,
            description="Frontend S3 Bucket ARN"
        )

        CfnOutput(
            self, "CloudFrontDistributionId",
            value=self.distribution.distribution_id,
            description="CloudFront Distribution ID"
        )

        CfnOutput(
            self, "CloudFrontDomainName",
            value=self.distribution.distribution_domain_name,
            description="CloudFront Distribution Domain Name",
            export_name=f"{project_name}-{environment}-cloudfront-domain"
        )

        CfnOutput(
            self, "FrontendURL",
            value=f"https://{self.distribution.distribution_domain_name}",
            description="Frontend URL (CloudFront)"
        )

        CfnOutput(
            self, "S3UploadCommand",
            value=f"aws s3 sync ./ s3://{self.frontend_bucket.bucket_name}/ --exclude '*' --include '*.html'",
            description="Command to upload frontend files to S3 (add --profile <name> if needed)"
        )
