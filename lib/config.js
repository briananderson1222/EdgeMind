// lib/config.js - Application Configuration Module
// Centralizes all configuration loading from environment variables with sensible defaults.

require('dotenv').config();

/**
 * Application configuration loaded from environment variables.
 *
 * @module lib/config
 * @property {Object} mqtt - MQTT broker configuration
 * @property {string} mqtt.host - MQTT broker host URL
 * @property {string} mqtt.username - MQTT authentication username
 * @property {string} mqtt.password - MQTT authentication password
 * @property {string[]} mqtt.topics - MQTT topics to subscribe to
 *
 * @property {Object} bedrock - AWS Bedrock configuration for Claude AI
 * @property {string} bedrock.region - AWS region for Bedrock service
 * @property {string} bedrock.modelId - Claude model identifier
 *
 * @property {Object} influxdb - InfluxDB time-series database configuration
 * @property {string} influxdb.url - InfluxDB server URL
 * @property {string} influxdb.token - InfluxDB authentication token
 * @property {string} influxdb.org - InfluxDB organization name
 * @property {string} influxdb.bucket - InfluxDB bucket name for factory data
 *
 * @property {boolean} disableInsights - Flag to disable Claude trend analysis loop
 *
 * @property {Object} cmms - Computerized Maintenance Management System configuration
 * @property {boolean} cmms.enabled - Whether CMMS integration is enabled
 * @property {string} cmms.provider - CMMS provider name (e.g., 'maintainx')
 * @property {Object} cmms.maintainx - MaintainX-specific configuration
 * @property {string} cmms.maintainx.apiKey - MaintainX API authentication key
 * @property {string} cmms.maintainx.baseUrl - MaintainX API base URL
 * @property {string|null} cmms.maintainx.defaultLocationId - Default location ID for work orders
 * @property {string|null} cmms.maintainx.defaultAssigneeId - Default assignee ID for work orders
 */
const CONFIG = {
  mqtt: {
    host: process.env.MQTT_HOST || 'mqtt://virtualfactory.proveit.services:1883',
    username: process.env.MQTT_USERNAME || 'proveitreadonly',
    password: process.env.MQTT_PASSWORD || '',
    topics: ['#']
  },
  bedrock: {
    region: process.env.AWS_REGION || 'us-east-1',
    modelId: process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    embeddingModelId: process.env.BEDROCK_EMBEDDING_MODEL_ID || 'amazon.titan-embed-text-v2:0'
  },
  influxdb: {
    url: process.env.INFLUXDB_URL || 'http://localhost:8086',
    token: process.env.INFLUXDB_TOKEN || '',
    org: process.env.INFLUXDB_ORG || 'proveit',
    bucket: process.env.INFLUXDB_BUCKET || 'factory'
  },
  disableInsights: process.env.DISABLE_INSIGHTS === 'true',
  cmms: {
    enabled: process.env.CMMS_ENABLED === 'true',
    provider: process.env.CMMS_PROVIDER || 'maintainx',
    maintainx: {
      apiKey: process.env.MAINTAINX_API_KEY || '',
      baseUrl: process.env.MAINTAINX_BASE_URL || 'https://api.getmaintainx.com/v1',
      defaultLocationId: process.env.MAINTAINX_DEFAULT_LOCATION_ID || null,
      defaultAssigneeId: process.env.MAINTAINX_DEFAULT_ASSIGNEE_ID || null
    }
  }
};

module.exports = CONFIG;
