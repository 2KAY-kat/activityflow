import nodemailer from 'nodemailer';
import { getAppBaseUrl } from './github-app';

type AssignmentEmailInput = {
  toEmail: string;
  ticketTitle: string;
  ticketKey?: string | null;
  assignedByName: string;
  teamName: string;
  actionUrl: string;
  inviteCode?: string;
  requiresJoinConfirmation?: boolean;
};

type TeamInvitationEmailInput = {
  toEmail: string;
  teamName: string;
  invitedByName: string;
  actionUrl: string;
  inviteCode: string;
};

type AssignmentUrlInput = {
  teamId?: number | null;
  ticketId?: number | null;
  inviteCode?: string | null;
};

function getMailConfig() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;

  if (smtpHost && smtpUser && smtpPassword) {
    return {
      transport: {
        host: smtpHost,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
        auth: {
          user: smtpUser,
          pass: smtpPassword,
        },
      },
      from: process.env.MAIL_FROM || smtpUser,
    };
  }

  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return {
      transport: {
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      },
      from: process.env.MAIL_FROM || process.env.GMAIL_USER,
    };
  }

  return null;
}

function getTransporter() {
  const config = getMailConfig();
  if (!config) {
    return null;
  }

  return nodemailer.createTransport(config.transport);
}

export function isEmailConfigured() {
  return Boolean(getMailConfig());
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildAssignmentUrl({ teamId, ticketId, inviteCode }: AssignmentUrlInput) {
  const url = new URL('/', `${getAppBaseUrl().replace(/\/$/, '')}/`);

  if (teamId) {
    url.searchParams.set('teamId', String(teamId));
  }

  if (ticketId) {
    url.searchParams.set('ticketId', String(ticketId));
  }

  if (inviteCode) {
    url.searchParams.set('inviteCode', inviteCode);
  }

  return url.toString();
}

export function buildTeamInviteUrl(teamId: number, inviteCode: string) {
  return buildAssignmentUrl({ teamId, inviteCode });
}

export async function sendAssignmentEmail({
  toEmail,
  ticketTitle,
  ticketKey,
  assignedByName,
  teamName,
  actionUrl,
  inviteCode,
  requiresJoinConfirmation = false,
}: AssignmentEmailInput) {
  const config = getMailConfig();
  const transporter = getTransporter();

  if (!config || !transporter) {
    console.warn('Email service not configured. Set SMTP_* or GMAIL_* variables to enable notifications.');
    return;
  }

  if (!toEmail) {
    console.warn('Assignment notification skipped because no recipient email was available.');
    return;
  }

  const safeTitle = escapeHtml(ticketTitle);
  const safeAssigner = escapeHtml(assignedByName);
  const safeTeamName = escapeHtml(teamName);
  const safeInviteCode = inviteCode ? escapeHtml(inviteCode) : null;
  const label = ticketKey ? `${ticketKey} - ${ticketTitle}` : ticketTitle;
  const subject = `New Assignment: ${label}`;
  const preface = requiresJoinConfirmation
    ? `You have been assigned work in ${teamName}. Confirm team access first to view the assignment.`
    : `You have been assigned work in ${teamName}.`;
  const inviteLine = safeInviteCode
    ? `Use invite code ${inviteCode} if you are prompted to join the team.`
    : '';
  const ctaLabel = requiresJoinConfirmation ? 'Confirm Contribution' : 'View Assignment';

  const mailOptions = {
    from: config.from,
    to: toEmail,
    subject,
    text: [
      `${preface}`,
      '',
      `Task: "${ticketTitle}"${ticketKey ? ` (${ticketKey})` : ''}`,
      `Assigned by: ${assignedByName}`,
      `Team: ${teamName}`,
      inviteLine,
      '',
      `${requiresJoinConfirmation ? 'Confirm access and open the assignment' : 'Open the assignment'}: ${actionUrl}`,
    ]
      .filter(Boolean)
      .join('\n'),
    html: `
      <div style="font-family: sans-serif; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; max-width: 560px;">
        <div style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #2563eb; font-weight: 700;">ActivityFlow Assignment</div>
        <h2 style="margin: 12px 0 8px; color: #111827;">${safeTitle}</h2>
        ${ticketKey ? `<div style="margin-bottom: 12px; color: #6b7280; font-size: 14px;">Ticket key: <strong>${escapeHtml(ticketKey)}</strong></div>` : ''}
        <p style="color: #374151; line-height: 1.6; margin: 0 0 12px;">
          <strong>${safeAssigner}</strong> assigned this work in <strong>${safeTeamName}</strong>.
        </p>
        <p style="color: #374151; line-height: 1.6; margin: 0 0 16px;">
          ${requiresJoinConfirmation
            ? 'You will be asked to confirm team participation before the assignment is shown.'
            : 'Open ActivityFlow to view the assignment immediately.'}
        </p>
        ${safeInviteCode ? `<div style="margin: 0 0 16px; padding: 12px; background: #f3f4f6; border-radius: 8px; color: #111827;">Invite code: <strong>${safeInviteCode}</strong></div>` : ''}
        <div style="margin: 20px 0;">
          <a href="${actionUrl}" style="background: #2563eb; color: white; padding: 12px 18px; border-radius: 8px; text-decoration: none; display: inline-block;">${ctaLabel}</a>
        </div>
        <p style="color: #6b7280; font-size: 13px; line-height: 1.5; margin: 16px 0 0;">
          If the button does not work, open this link manually:<br>
          <a href="${actionUrl}" style="color: #2563eb;">${actionUrl}</a>
        </p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Assignment email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending assignment email:', error);
    throw error;
  }
}

export async function sendTeamInvitationEmail({
  toEmail,
  teamName,
  invitedByName,
  actionUrl,
  inviteCode,
}: TeamInvitationEmailInput) {
  const config = getMailConfig();
  const transporter = getTransporter();

  if (!config || !transporter) {
    console.warn('Email service not configured. Set SMTP_* or GMAIL_* variables to enable notifications.');
    return;
  }

  if (!toEmail) {
    console.warn('Team invitation skipped because no recipient email was provided.');
    return;
  }

  const safeTeamName = escapeHtml(teamName);
  const safeInvitedBy = escapeHtml(invitedByName);
  const safeInviteCode = escapeHtml(inviteCode);
  const subject = `Join ${teamName} on ActivityFlow`;

  const mailOptions = {
    from: config.from,
    to: toEmail,
    subject,
    text: [
      `You have been invited to join ${teamName} on ActivityFlow.`,
      '',
      `Invited by: ${invitedByName}`,
      `Team: ${teamName}`,
      `Invite code: ${inviteCode}`,
      '',
      'Open the invite link, sign in or create your account, and confirm your contribution to join the team:',
      actionUrl,
      '',
      'After you join, you will be able to collaborate on the team board and be assigned to tickets.',
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; max-width: 560px;">
        <div style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #2563eb; font-weight: 700;">ActivityFlow Team Invite</div>
        <h2 style="margin: 12px 0 8px; color: #111827;">Join ${safeTeamName}</h2>
        <p style="color: #374151; line-height: 1.6; margin: 0 0 12px;">
          <strong>${safeInvitedBy}</strong> invited you to collaborate in <strong>${safeTeamName}</strong>.
        </p>
        <p style="color: #374151; line-height: 1.6; margin: 0 0 16px;">
          Sign in or create your ActivityFlow account, confirm your contribution, and you will be added to the team board.
        </p>
        <div style="margin: 0 0 16px; padding: 12px; background: #f3f4f6; border-radius: 8px; color: #111827;">
          Invite code: <strong>${safeInviteCode}</strong>
        </div>
        <div style="margin: 20px 0;">
          <a href="${actionUrl}" style="background: #2563eb; color: white; padding: 12px 18px; border-radius: 8px; text-decoration: none; display: inline-block;">Confirm Contribution</a>
        </div>
        <p style="color: #6b7280; font-size: 13px; line-height: 1.5; margin: 16px 0 0;">
          After you join, you can collaborate on the team board and be assigned to existing tickets.<br>
          If the button does not work, open this link manually:<br>
          <a href="${actionUrl}" style="color: #2563eb;">${actionUrl}</a>
        </p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Team invitation email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending team invitation email:', error);
    throw error;
  }
}
