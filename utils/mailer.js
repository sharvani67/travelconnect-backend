const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", // or your SMTP host
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_EMAIL,      // your email
    pass: process.env.SMTP_PASSWORD    // app password
  }
});

module.exports = transporter;