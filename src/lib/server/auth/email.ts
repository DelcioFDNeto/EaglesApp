/**
 * Envio de e-mail para fluxo de "esqueci minha senha".
 *
 * Duas opções suportadas:
 *  - Resend (API externa): rápido, free tier, funciona com domínio de teste
 *    resend.dev sem precisar de domínio próprio.
 *  - Nodemailer + SMTP: usa uma conta de e-mail existente (Gmail, Outlook).
 *
 * Escolha uma das implementações abaixo e defina as variáveis de ambiente
 * correspondentes no .env da VPS.
 */

// ---------------------------------------------------------------------------
// Opção 1: Resend (recomendado para começar)
// ---------------------------------------------------------------------------
// export async function enviarEmailReset(destinatario: string, linkReset: string) {
// 	const resend = new Resend(process.env.RESEND_API_KEY);
//
// 	await resend.emails.send({
// 		from: 'Eagles App <onboarding@resend.dev>',
// 		to: [destinatario],
// 		subject: 'Redefinir sua senha - Eagles',
// 		html: `
// 			<p>Você solicitou a redefinição de senha.</p>
// 			<p><a href="${linkReset}">Clique aqui para definir uma nova senha</a></p>
// 			<p>Este link expira em 15 minutos.</p>
// 			<p>Se não foi você, ignore este e-mail.</p>
// 		`,
// 	});
// }

// ---------------------------------------------------------------------------
// Opção 2: Nodemailer + SMTP (usa sua conta de e-mail existente)
// ---------------------------------------------------------------------------
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
	host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
	port: Number(process.env.SMTP_PORT ?? 587),
	secure: process.env.SMTP_SECURE === 'true',
	auth: {
		user: process.env.SMTP_USER,
		pass: process.env.SMTP_PASS // senha de app, não a senha normal
	}
});

export async function enviarEmailReset(destinatario: string, linkReset: string) {
	await transporter.sendMail({
		from: `"Eagles App" <${process.env.SMTP_USER}>`,
		to: [destinatario],
		subject: 'Redefinir sua senha - Eagles',
		text: `Use este link para redefinir sua senha: ${linkReset} (expira em 15 minutos)`,
		html: `
			<p>Você solicitou a redefinição de senha.</p>
			<p><a href="${linkReset}">Clique aqui para definir uma nova senha</a></p>
			<p>Este link expira em 15 minutos.</p>
			<p>Se não foi você, ignore este e-mail.</p>
		`
	});
}
