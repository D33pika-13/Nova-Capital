import "server-only";
import nodemailer from "nodemailer";
import { z } from "zod";
import type { EmailProvider, EmailMessage } from "@/server/contracts";
import type { ServerConfig } from "@/server/config";
import { AppError } from "@/server/errors";
export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  constructor(private readonly config: Readonly<ServerConfig>) {
    const local =
      (["localhost", "127.0.0.1", "::1"].includes(config.SMTP_HOST ?? "") ||
        (config.SMTP_ALLOW_INSECURE_LOCAL &&
          ["mail", "mailpit"].includes(config.SMTP_HOST ?? ""))) &&
      ["development", "test"].includes(config.APP_ENV) &&
      !config.SMTP_USER &&
      !config.SMTP_PASSWORD;
    this.transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      requireTLS: !local,
      auth: config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 15000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  async send(message: EmailMessage) {
    if (
      !z.email().safeParse(message.to).success ||
      (message.replyTo !== undefined &&
        !z.email().safeParse(message.replyTo).success) ||
      /[\r\n]/.test(message.subject) ||
      message.subject.length > 200 ||
      message.text.length > 64000
    )
      throw new AppError("INVALID_EMAIL", "The email request is invalid.", 422);
    try {
      const info = await this.transport.sendMail({
        from: this.config.EMAIL_FROM,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (
        !info.accepted.some(
          (address: unknown) =>
            String(address).toLowerCase() === message.to.toLowerCase(),
        )
      )
        throw new Error("Not accepted");
    } catch {
      throw new AppError(
        "EMAIL_UNCERTAIN",
        "Email acceptance could not be confirmed.",
        503,
      );
    }
  }
}
