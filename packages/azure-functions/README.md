# Azure Functions Package

This package provides Azure Functions deployment for Copilot Portal.

## Prerequisites

1. Install Azure Functions Core Tools:
   ```bash
   # macOS
   brew tap azure/functions
   brew install azure-functions-core-tools@4

   # Or see: https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local
   ```

2. Azure CLI (for deployment):
   ```bash
   brew install azure-cli
   az login
   ```

## Local Development

```bash
cd packages/azure
pnpm install
pnpm start
# → Running at http://localhost:7071
```

## Deploy to Azure

1. Create Azure resources (one-time):
   ```bash
   # Create resource group
   az group create --name copilot-portal-rg --location eastasia

   # Create storage account
   az storage account create \
     --name copilotportalstorage \
     --location eastasia \
     --resource-group copilot-portal-rg \
     --sku Standard_LRS

   # Create function app
   az functionapp create \
     --resource-group copilot-portal-rg \
     --consumption-plan-location eastasia \
     --runtime node \
     --runtime-version 22 \
     --functions-version 4 \
     --name copilot-portal \
     --storage-account copilotportalstorage
   ```

2. Deploy:
   ```bash
   pnpm build
   func azure functionapp publish copilot-portal
   ```

Your API will be available at: `https://copilot-portal.azurewebsites.net`

## Usage

Same as CF Workers deployment:

```bash
curl https://copilot-portal.azurewebsites.net/v1/chat/completions \
  -H "Authorization: Bearer <your_copilot_token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4.5","messages":[{"role":"user","content":"Hello!"}]}'
```
