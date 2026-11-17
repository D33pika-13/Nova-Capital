import { PageIntro } from "@/components/page-intro";
import { ContactForm } from "@/components/contact-form";
import { siteConfig } from "@/lib/site-config";
import { loadConfig } from "@/server/config";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Contact",
  description:
    "Contact the support team about services, account access or client reports.",
};
export default async function ContactPage() {
  const config = await loadConfig();
  return (
    <>
      <PageIntro eyebrow="CONTACT" title="Start with a conversation.">
        <p>
          Ask about services, account access or your client reports. The form
          sends your enquiry to the configured support team.
        </p>
      </PageIntro>
      <section className="section container">
        <div className="contact-layout">
          <div>
            <h2>Contact support</h2>
            {config.APP_ENV !== "production" && (
              <p role="note">
                Test environment: use synthetic details only. Messages are for
                testing and may be captured in a test mailbox. Do not include
                passwords, identity documents or financial information.
              </p>
            )}
            {siteConfig.contactEmail && (
              <p>
                <a href={`mailto:${siteConfig.contactEmail}`}>
                  {siteConfig.contactEmail}
                </a>
              </p>
            )}
            {siteConfig.phone && <p>{siteConfig.phone}</p>}
            {siteConfig.address && <p>{siteConfig.address}</p>}
            {!siteConfig.contactEmail &&
              !siteConfig.phone &&
              !siteConfig.address && (
                <p>
                  Verified company contact details have not been published in
                  this environment.
                </p>
              )}
            <p className="small muted">
              {siteConfig.name} is the temporary development brand. Published
              company and legal details require review before launch.
            </p>
          </div>
          <ContactForm
            enabled={config.SERVICES_ENABLED && config.CONTACT_ENABLED}
          />
        </div>
      </section>
    </>
  );
}
