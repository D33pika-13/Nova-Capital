import "server-only";
import { redirect } from "next/navigation";
import { createServices } from "./composition";
import { AppError } from "./errors";
export async function requirePageUser(admin = false) {
  let services;
  try {
    services = await createServices();
  } catch (error) {
    if (error instanceof AppError && error.code === "SERVICES_UNAVAILABLE")
      redirect("/login");
    throw error;
  }
  try {
    return {
      services,
      context: admin
        ? await services.auth.requireAdmin()
        : await services.auth.requireUser(),
    };
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "MFA_REQUIRED") redirect("/mfa");
      if (error.status === 401 || error.status === 403) redirect("/login");
    }
    throw error;
  }
}
