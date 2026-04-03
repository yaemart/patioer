import Fastify from 'fastify'
import corsPlugin from './plugins/cors.js'
import sensible from '@fastify/sensible'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import metricsPlugin from './plugins/metrics.js'
import tenantPlugin from './plugins/tenant.js'
import healthRoute from './routes/health.js'
import tenantDiscoveryRoute from './routes/tenant-discovery.js'
import onboardingRoute from './routes/onboarding.js'
import shopifyOauthRoute from './routes/shopify/oauth.js'
import shopifyWebhookRoute from './routes/shopify/webhook.js'
import productsRoute from './routes/products.js'
import ordersRoute from './routes/orders.js'
import agentsRoute from './routes/agents.js'
import approvalsRoute from './routes/approvals.js'
import agentsExecuteRoute from './routes/agents-execute.js'
import amazonOAuthRoute from './routes/amazon/oauth.js'
import amazonWebhookRoute from './routes/amazon/webhook.js'
import tikTokOAuthRoute from './routes/tiktok/oauth.js'
import tikTokWebhookRoute from './routes/tiktok/webhook.js'
import shopeeOAuthRoute from './routes/shopee/oauth.js'
import shopeeWebhookRoute from './routes/shopee/webhook.js'
import platformCredentialsRoute from './routes/platform-credentials.js'
import adsInventoryRoute from './routes/ads-inventory.js'
import agentEventsRoute from './routes/agent-events.js'
import consoleRoute from './routes/console.js'
import authRoute from './routes/auth.js'
import billingRoute from './routes/billing.js'
import webhookStripeRoute from './routes/webhook-stripe.js'
import onboardingWizardRoute from './routes/onboarding-wizard.js'
import clipmartRoute from './routes/clipmart.js'
import growthRoute from './routes/growth.js'
import settingsRoute from './routes/settings.js'
import dashboardRoute from './routes/dashboard.js'
import walmartOAuthRoute from './routes/walmart/oauth.js'
import walmartWebhookRoute from './routes/walmart/webhook.js'
import b2bWayfairRoute from './routes/b2b-wayfair.js'
import goalsRoute from './routes/goals.js'
import sopRoute from './routes/sop.js'
import serviceRoute from './routes/service.js'
import accountHealthRoute from './routes/account-health.js'
import inventoryInboundRoute from './routes/inventory-inbound.js'
import metricsAgentsRoute from './routes/metrics-agents.js'

export const buildServer = () => {
  const app = Fastify({ logger: true })

  // CORS before auth/metrics so preflight succeeds for browser clients (split web + API deploys).
  app.register(corsPlugin)

  // Metrics after CORS; onResponse still covers all routes.
  app.register(metricsPlugin)

  app.register(swagger, {
    openapi: {
      info: {
        title: 'ElectroOS API',
        description:
          'ElectroOS multi-tenant API: onboarding (tenant register), agents, approvals, Shopify / Amazon / TikTok / Shopee OAuth & webhooks, Paperclip execution. Optional header x-platform (shopify|amazon|tiktok|shopee) pins harness credential selection for sync/execute routes.',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${process.env.PORT ?? 3100}` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header' },
        },
      },
    },
  })
  app.register(swaggerUi, { routePrefix: '/api/v1/docs' })

  app.register(sensible)
  app.register(tenantPlugin)
  app.register(healthRoute)
  app.register(tenantDiscoveryRoute)
  app.register(onboardingRoute)
  app.register(shopifyOauthRoute)
  app.register(shopifyWebhookRoute)
  app.register(productsRoute)
  app.register(ordersRoute)
  app.register(agentsRoute)
  app.register(approvalsRoute)
  app.register(agentsExecuteRoute)
  app.register(amazonOAuthRoute)
  app.register(amazonWebhookRoute)
  app.register(tikTokOAuthRoute)
  app.register(tikTokWebhookRoute)
  app.register(shopeeOAuthRoute, { prefix: '/api/v1/shopee' })
  app.register(shopeeWebhookRoute)
  app.register(platformCredentialsRoute)
  app.register(adsInventoryRoute)
  app.register(agentEventsRoute)
  app.register(consoleRoute)
  app.register(authRoute)
  app.register(billingRoute)
  app.register(webhookStripeRoute)
  app.register(onboardingWizardRoute)
  app.register(clipmartRoute)
  app.register(growthRoute)
  app.register(settingsRoute)
  app.register(dashboardRoute)
  app.register(walmartOAuthRoute)
  app.register(walmartWebhookRoute)
  app.register(b2bWayfairRoute)
  app.register(goalsRoute)
  app.register(sopRoute)
  app.register(serviceRoute)
  app.register(accountHealthRoute)
  app.register(inventoryInboundRoute)
  app.register(metricsAgentsRoute)

  return app
}
