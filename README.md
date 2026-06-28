# Emergency Alert App

A cross-platform emergency alert application for Android and iOS, built per the product specification. Users can trigger an SOS alert, securely transmit their location to a backend, and notify trusted contacts and nearby users.

## Architecture

```
├── backend/          Node.js + Express API
│                     PostgreSQL database
│                     Redis geo-indexing
│                     Firebase Cloud Messaging
└── mobile/           Flutter app (Android + iOS)
```

## Features

- **Authentication** — Phone/email registration, OTP verification, JWT tokens
- **SOS Trigger** — Large in-app panic button with confirmation dialog
- **Location** — GPS capture with permission handling
- **Encryption** — AES-256-GCM payload encryption with RSA-4096 key exchange
- **Emergency Contacts** — Add/remove trusted contacts
- **Nearby Alerts** — Redis geo-radius discovery (2–5 km configurable)
- **Push Notifications** — Firebase Cloud Messaging integration
- **False Alarm Cancellation** — 30-second grace period to cancel
- **Alert History** — View past alerts with map links

## Prerequisites

- **Node.js** 18+
- **PostgreSQL** 14+
- **Redis** 6+ (optional, for nearby user discovery)
- **Flutter** 3.16+ (for mobile app)
- **Firebase project** (optional, for push notifications)

## Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your database credentials and secrets

# Generate RSA-4096 encryption keys
node src/utils/encryption.js

# Create database and tables
createdb emergency_alert
npm run db:init

# Start the API server
npm run dev
```

The API runs at `http://localhost:3000`.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Register new user |
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/verify-otp` | Verify phone/email OTP |
| POST | `/api/v1/auth/device` | Register FCM device token |
| GET | `/api/v1/auth/public-key` | Get server RSA public key |
| GET | `/api/v1/auth/me` | Get current user profile |
| POST | `/api/v1/emergency` | Send encrypted emergency alert |
| POST | `/api/v1/emergency/:id/cancel` | Cancel false alarm |
| GET | `/api/v1/emergency` | Alert history |
| GET/POST/DELETE | `/api/v1/contacts` | Manage emergency contacts |

## Mobile App Setup

```bash
cd mobile
flutter pub get

# Update API URL in lib/config/api_config.dart
# Use 10.0.2.2 for Android emulator, your machine IP for physical devices

flutter run
```

### Firebase Setup (Optional)

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Add Android and iOS apps
3. Run `flutterfire configure` in the mobile directory
4. Place your service account JSON in `backend/firebase-service-account.json`

## Security

- TLS 1.3 in production (configure via reverse proxy)
- Hybrid encryption: AES-256-GCM + RSA-4096
- JWT authentication with configurable expiry
- Rate limiting on auth and emergency endpoints
- Replay attack protection via nonce tracking
- Request timestamp validation (5-minute window)
- Secure token storage via `flutter_secure_storage`

## Testing

In development mode, the backend logs OTP codes to the console and accepts unencrypted alert payloads for easier testing.

```bash
# Health check
curl http://localhost:3000/health

# Register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","phone":"+1234567890","password":"test123"}'
```

## Project Structure

```
backend/
  src/
    config/         Environment configuration
    db/             PostgreSQL pool, Redis, schema init
    middleware/     Auth, rate limiting
    routes/         Auth, emergency, contacts
    services/       Push notifications
    utils/          Encryption, JWT, OTP

mobile/
  lib/
    config/         API configuration
    models/         Data models
    providers/      State management
    screens/        UI screens
    services/       API, encryption, location, notifications
```
