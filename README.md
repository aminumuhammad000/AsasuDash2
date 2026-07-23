# ASASU Realty Commission Portal

A professional, full-stack commission tracking platform for real estate agents and administrators.

## 🚀 Features
- **Real-time Dashboard**: Live analytics and charts (Chart.js).
- **Secure Authentication**: JWT-based login with admin approval workflow.
- **Claim Management**: File uploads (Multer), live status updates, and Excel exports.
- **Instant Notifications**: Real-time popups via Socket.io and automated emails via Nodemailer.
- **Email Verification**: Mandatory OTP verification for all new agent registrations.
- **Support System**: Internal ticketing and direct messaging.

## 🛠️ Tech Stack
- **Frontend**: HTML5, CSS3, JavaScript, Chart.js, Socket.io-client.
- **Backend**: Node.js, Express.js, MongoDB (Mongoose).
- **Security**: Bcrypt, JWT, Rate Limiting.

## 📦 Installation

1. **Clone the repository**
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure Environment**:
   Create a `.env` file in the root directory:
   ```env
   PORT=5000
   MONGODB_URI=mongodb://localhost:27017/asasu_portal
   JWT_SECRET=your_secure_random_secret

   # SMTP Configuration (for Emails & OTP)
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASS=your-app-password
   EMAIL_FROM="ASASU Realty Portal" <your-email@gmail.com>
   ```
   *Note: If using Gmail, you must use an [App Password](https://myaccount.google.com/apppasswords).*
4. **Seed Initial Data**:
   ```bash
   npm run seed
   ```

## 🏃 Usage
- **Development**: `npm run dev`
- **Production**: `npm start`

## 👥 Default Credentials (after seeding)
- **Admin**: `admin@asasurealty.com` / `admin123`
- **Agent**: `john@example.com` / `AGT-001`

---
*Developed for ASASU Realty Ltd.*
# AsasuDash2
