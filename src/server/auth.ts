import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

export type AuthUser = {
  id: string;
  username: string;
  role: "nurse" | "head_nurse";
  displayName: string;
  participantCode: string;
};

const secret = () =>
  new TextEncoder().encode(
    process.env.JWT_SECRET ?? "icu-tasklog-local-demo-secret-change-in-production",
  );

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export async function signToken(user: AuthUser): Promise<string> {
  return new SignJWT({
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    participantCode: user.participantCode,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(secret());
}

export async function verifyToken(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, secret());
  if (!payload.sub || typeof payload.role !== "string") throw new Error("Invalid token");
  return {
    id: payload.sub,
    username: String(payload.username ?? ""),
    role: payload.role === "head_nurse" ? "head_nurse" : "nurse",
    displayName: String(payload.displayName ?? ""),
    participantCode: String(payload.participantCode ?? ""),
  };
}
