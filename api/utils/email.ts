import nodemailer from 'nodemailer';

// Configure transporter with Google SMTP
// Note: User needs to provide GMAIL_USER and GMAIL_APP_PASSWORD in .env
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

export async function sendAssignmentEmail(toEmail: string, ticketTitle: string, assignedByName: string) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        console.warn('Email service not configured. Skipping notification.');
        return;
    }

    const mailOptions = {
        from: `"ActivityFlow" <${process.env.GMAIL_USER}>`,
        to: toEmail,
        subject: `New Assignment: ${ticketTitle}`,
        text: `You have been assigned a new task: "${ticketTitle}" by ${assignedByName}.\n\nView it on your board: ${process.env.APP_URL || 'http://localhost:3000'}`,
        html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #2563eb;">New Task Assigned</h2>
                <p>Hello,</p>
                <p>You have been assigned a new task: <strong>"${ticketTitle}"</strong> by <strong>${assignedByName}</strong>.</p>
                <div style="margin: 20px 0;">
                    <a href="${process.env.APP_URL || 'http://localhost:3000'}" style="background: #2563eb; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none;">View Dashboard</a>
                </div>
                <p style="color: #666; font-size: 0.9em;">Good luck with your task!</p>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: %s', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending assignment email:', error);
        throw error;
    }
}
