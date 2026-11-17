import Link from "next/link";
import { PageIntro } from "@/components/page-intro";
import { educationServices } from "@/lib/education-inputs";
export const metadata = {
  title: "Education",
  description:
    "Register interest in premium webinars and individual mentorship sessions.",
};
export default function EducationPage() {
  return (
    <>
      <PageIntro eyebrow="EDUCATION" title="Build your understanding.">
        <p>
          Explore financial education in a format that suits you. Request
          details and our team will follow up about availability and the next
          steps.
        </p>
      </PageIntro>
      <section className="section container">
        <div className="education-grid">
          {Object.entries(educationServices).map(([value, label]) => (
            <article className="panel education-card" key={value}>
              <p className="eyebrow">
                {value === "webinars" ? "LEARN TOGETHER" : "PERSONAL LEARNING"}
              </p>
              <h2>{label}</h2>
              <p>
                {value === "webinars"
                  ? "Explore concepts, market knowledge and practical questions through guided group learning."
                  : "Request focused, one-to-one learning around the topics and questions you want to understand."}
              </p>
              <Link
                className="button button-dark"
                href={`/education/request?service=${value}`}
              >
                Request {label.toLowerCase()} ↗
              </Link>
            </article>
          ))}
        </div>
        <p className="small muted">
          Submitting a request does not book a session or make a payment.
          Availability and any terms will be discussed with you. Education does
          not guarantee investment results.
        </p>
      </section>
    </>
  );
}
