import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import {
  contactSchema,
  contactTopics,
  type ContactStatus,
  type ContactResult,
} from "@/lib/contact-inputs";
import type { EmailProvider, RateLimiter } from "@/server/contracts";
import { AppError } from "@/server/errors";
export interface ContactRepository {
  status(id: string, hash: string): Promise<ContactStatus | null>;
  claim(
    id: string,
    hash: string,
  ): Promise<{ claimed: boolean; status: ContactStatus }>;
  finish(
    id: string,
    hash: string,
    status: "accepted" | "unknown",
  ): Promise<ContactStatus>;
}
export interface ContactOptions {
  enabled: boolean;
  recipient?: string;
  secret?: string;
}
export class ContactService {
  constructor(
    private readonly repository: ContactRepository,
    private readonly email: EmailProvider,
    private readonly limits: RateLimiter,
    private readonly options: ContactOptions,
  ) {}
  private digest(namespace: string, value: string) {
    return createHmac("sha256", this.options.secret!)
      .update(`${namespace}:${value}`)
      .digest("hex");
  }
  private result(reference: string, status: ContactStatus): ContactResult {
    return {
      reference,
      status,
      message:
        status === "accepted"
          ? "The email service accepted your enquiry. Inbox delivery and a response are not confirmed."
          : status === "processing"
            ? "This submission is already processing. It has not been sent again. Check its status shortly."
            : "Email acceptance is uncertain. This submission will not be sent again automatically. Check with support through another verified contact method before creating a new enquiry.",
    };
  }
  async submit(raw: unknown, clientAddress: string | null) {
    if (
      !this.options.enabled ||
      !this.options.recipient ||
      !this.options.secret
    )
      throw new AppError(
        "CONTACT_UNAVAILABLE",
        "The contact service is not connected in this environment.",
        503,
      );
    if (clientAddress !== null && !isIP(clientAddress))
      throw new AppError(
        "CONTACT_UNAVAILABLE",
        "The contact network context could not be verified.",
        503,
      );
    const parsed = contactSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError(
        "INVALID_INPUT",
        "Enter a valid name, email, topic and message, and confirm permission to send it.",
        422,
      );
    const input = parsed.data;
    const clientKey = this.digest(
      "network",
      clientAddress ?? "unidentified-local",
    );
    if (!(await this.limits.consume(`contact:attempt:${clientKey}`, 30, 60)))
      throw new AppError(
        "RATE_LIMITED",
        "Too many requests. Wait a minute before checking again.",
        429,
      );
    const hash = this.digest(
      "payload",
      JSON.stringify({
        name: input.name,
        email: input.email,
        topic: input.topic,
        message: input.message,
        consent: input.consent,
        recipient: this.options.recipient.toLowerCase(),
      }),
    );
    const previous = await this.repository.status(input.requestId, hash);
    if (previous) return this.result(input.requestId, previous);
    if (
      !(await this.limits.consume(`contact:network:${clientKey}`, 5, 3600)) ||
      !(await this.limits.consume(
        `contact:email:${this.digest("email", input.email)}`,
        3,
        3600,
      )) ||
      !(await this.limits.consume("contact:global", 50, 3600))
    )
      throw new AppError(
        "RATE_LIMITED",
        "The contact submission limit has been reached. Please try later.",
        429,
      );
    const claim = await this.repository.claim(input.requestId, hash);
    if (!claim.claimed) return this.result(input.requestId, claim.status);
    try {
      await this.email.send({
        to: this.options.recipient,
        replyTo: input.email,
        subject: `Website enquiry — ${contactTopics[input.topic]}`,
        text: `Website contact enquiry\nReference: ${input.requestId}\nName: ${input.name}\nReply address supplied by visitor (not verified): ${input.email}\nTopic: ${contactTopics[input.topic]}\n\n${input.message}`,
      });
      return this.result(
        input.requestId,
        await this.repository.finish(input.requestId, hash, "accepted"),
      );
    } catch {
      let status: ContactStatus = "unknown";
      try {
        status = await this.repository.finish(input.requestId, hash, "unknown");
      } catch {
        /* A persisted processing claim prevents duplicate sends during an outage. */
      }
      return this.result(input.requestId, status);
    }
  }
}
