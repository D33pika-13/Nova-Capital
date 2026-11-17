import "server-only";
export type Role = "client" | "admin";
export type AccountStatus = "active" | "suspended" | "deactivated";
export interface VerifiedIdentity {
  mfaEnrolled?: boolean;
  subject: string;
  provider: string;
  assurance: "aal1" | "aal2";
}
export interface Profile {
  id: string;
  externalSubject: string;
  role: Role;
  status: AccountStatus;
  clientId: string | null;
  displayName: string;
}
export interface IdentityProvider {
  verify(): Promise<VerifiedIdentity | null>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestReset(email: string): Promise<void>;
  setPassword(password: string): Promise<void>;
}
export interface ProfileRepository {
  findByIdentity(identity: VerifiedIdentity): Promise<Profile | null>;
}
export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}
export interface PrivateStorage {
  verifyConfiguration(): Promise<void>;
  putIfAbsent(
    path: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<void>;
  checksum(path: string, maxBytes: number): Promise<string>;
  downloadUrl(
    path: string,
    expiresIn: number,
    fileName: string,
  ): Promise<string>;
  remove(path: string): Promise<void>;
}
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}
export interface SecretProvider {
  resolve(): Promise<Readonly<Record<string, string>>>;
}
export interface Telemetry {
  event(name: string, fields?: Record<string, string | number | boolean>): void;
}
