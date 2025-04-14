# PYUSD Guardian

![PYUSD Guardian](https://via.placeholder.com/800x200?text=PYUSD+Guardian)

> Real-time PYUSD transaction monitoring and compliance system powered by GCP's Blockchain RPC service

## 🔍 Overview

PYUSD Guardian leverages Google Cloud Platform's Blockchain RPC service to provide unprecedented visibility into PYUSD stablecoin transactions. By utilizing computationally expensive trace methods (`debug_traceTransaction`, `trace_block`) that would be cost-prohibitive on other platforms, we enable comprehensive security monitoring for PYUSD transactions at scale.

**Key Differentiators:**
- Full transaction trace analysis for every PYUSD interaction
- Multi-hop token tracking through complex contract interactions
- Real-time compliance alerts via multiple channels (Discord, Telegram, Email)
- Economically feasible only through GCP's Blockchain RPC service

## ✨ Features

- **Deep Transaction Analysis**: Examine the full execution context of every PYUSD transaction
- **Compliance Monitoring**: Identify high-risk transaction patterns and suspicious behavior
- **Multi-Channel Alerts**: Receive notifications via Discord, Telegram, or Email based on preferences
- **Custom Risk Rules**: Configure and deploy custom compliance rules for your organization
- **Forensic Reports**: Generate detailed trace analysis reports for security teams

## 💡 Why GCP's Blockchain RPC Service?

Traditional RPC providers charge significant fees for trace-related methods, making comprehensive monitoring economically unfeasible:

| Provider | `debug_traceTransaction` Cost | Monthly Cost (10K tx/day) |
|----------|-------------------------------|---------------------------|
| Standard RPC | $0.10-0.50 per trace | $30,000-150,000 |
| GCP Blockchain RPC | Free with service | $0 (included) |

**This cost advantage enables:**
- 100% transaction coverage instead of sampling
- Deep analysis of every transaction's execution context
- Proactive monitoring instead of reactive investigation

## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- MongoDB
- GCP account with Blockchain RPC service enabled

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/pyusd-guardian.git
cd pyusd-guardian

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your GCP credentials, MongoDB URI, etc.

# Start the service
npm start
```

### Configuration

Edit your `.env` file with the following settings:

```
# GCP Settings
GCP_PROJECT_ID=your-project-id
GCP_NODE_URL=https://your-gcp-blockchain-node-url

# MongoDB
MONGODB_URI=mongodb://localhost:27017/pyusd-guardian

# Notification Settings (Optional)
DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
EMAIL_API_KEY=your-email-service-api-key

# PYUSD Contract
PYUSD_ADDRESS=0x1456688345527bE1f37E9e627DA0837D6f08C925
```

## 📊 Architecture

```
                            Google Cloud Platform (GCP)
+-------------------+      +-------------------------+      +------------------+
| Ethereum Network  | ---> | GCP Blockchain RPC      | ---> | Trace Processor  |
| (PYUSD Contract)  |      | (debug_traceTransaction)|      | (Express.js)     |
+-------------------+      +-------------------------+      +------------------+
                                                                     |
                                                                     v
+-------------------+      +-------------------------+      +------------------+
| Alert System      | <--- | Compliance Engine       | <--- | MongoDB Storage  |
| (Email/Telegram/  |      | (Pattern Recognition)   |      | (Transaction &   |
|  Discord)         |      |                         |      |  Alert Data)     |
+-------------------+      +-------------------------+      +------------------+
```

## 🔧 API Usage

### Fetch Alerts

```bash
curl -X GET "http://localhost:3000/api/alerts?severity=high&page=1&limit=10"
```

### Register for Notifications

```bash
curl -X POST "http://localhost:3000/api/notification-preferences" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "discord": "https://discord.com/api/webhooks/...",
    "telegram": "@username",
    "severity": "medium",
    "frequency": "immediate"
  }'
```

### Get System Stats

```bash
curl -X GET "http://localhost:3000/api/stats"
```

## 🛠️ Development

```bash
# Run tests
npm test

# Run in development mode with hot reloading
npm run dev

# Lint code
npm run lint
```

## 📝 Example Trace Analysis

Below is an example of how PYUSD Guardian analyzes transaction traces to identify complex, potentially suspicious patterns:

```javascript
// Sample from our trace analysis engine
function analyzeTrace(trace) {
  // Initialize risk report
  const riskReport = { flagged: false, issues: [], severity: 'low' };
  
  // Check for proxy patterns
  const proxyHops = countProxyHops(trace.calls);
  if (proxyHops > 3) {
    riskReport.flagged = true;
    riskReport.issues.push('EXCESSIVE_PROXY_HOPS');
    riskReport.severity = 'medium';
  }
  
  // Check for known high-risk patterns
  if (detectCircularTransfers(trace.calls)) {
    riskReport.flagged = true;
    riskReport.issues.push('CIRCULAR_TRANSFER_PATTERN');
    riskReport.severity = 'high';
  }
  
  // More analysis rules...
  
  return riskReport;
}
```

## 🔒 Security Considerations

- API endpoints should be properly secured in production
- Store sensitive keys in GCP Secret Manager
- Consider IP whitelisting for administrative functions
- Enable 2FA for all project contributors

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Contact

Project Link: [https://github.com/yourusername/pyusd-guardian](https://github.com/yourusername/pyusd-guardian)

---

Built with ❤️ for the GCP & PYUSD Hackathon