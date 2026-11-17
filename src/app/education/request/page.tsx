import { PageIntro } from "@/components/page-intro";
import { EducationForm } from "@/components/education-form";
import { loadConfig } from "@/server/config";
import Link from "next/link";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Request education",
  description: "Ask about a webinar or individual mentorship session.",
};
export default async function EducationRequestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const service =
    params.service === "webinars" || params.service === "mentorship"
      ? params.service
      : "";
  const config = await loadConfig();
  return (
    <>
      <PageIntro
        eyebrow="EDUCATION REQUEST"
        title="Tell us what you’d like to learn."
      >
        <p>Open to visitors and existing clients. No sign-in is required.</p>
      </PageIntro>
      <section className="section container">
        <div className="education-form-wrap panel">
          {config.APP_ENV !== "production" && (
            <p role="note">
              Test environment: use synthetic contact details only. Requests are
              stored for administrator review.
            </p>
          )}
          <EducationForm
            service={service}
            enabled={config.SERVICES_ENABLED && config.EDUCATION_ENABLED}
          />
          <Link href="/education">← Back to Education</Link>
        </div>
      </section>
    </>
  );
}
