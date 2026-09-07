const nodemailer = require('nodemailer');

// Configure transporter for Outlook/Hotmail (Office365 SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.HOTMAIL_HOST || 'smtp.office365.com',
  port: process.env.HOTMAIL_PORT ? Number(process.env.HOTMAIL_PORT) : 587,
  secure: false, // use STARTTLS
  auth: {
    user: process.env.HOTMAIL_USER,
    pass: process.env.HOTMAIL_PASS,
  },
});

// Verify transporter at startup (optional)
if (process.env.NODE_ENV !== 'test') {
  transporter.verify().then(() => {
    console.log('Mailer: SMTP connection verified');
  }).catch((err) => {
    console.warn('Mailer: SMTP verification failed -', err.message);
  });
}

async function sendMail({ to, subject, text, html }) {
  if (!process.env.HOTMAIL_USER || !process.env.HOTMAIL_PASS) {
    throw new Error('Missing HOTMAIL_USER or HOTMAIL_PASS in environment');
  }

  const from = process.env.HOTMAIL_FROM || process.env.HOTMAIL_USER;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  return info;
}

module.exports = { sendMail };
