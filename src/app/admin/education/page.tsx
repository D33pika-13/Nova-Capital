import Link from "next/link";
import { requirePageUser } from "@/server/page-auth";
import { educationPageSchema, educationServices } from "@/lib/education-inputs";
import { formatDate } from "@/lib/format";
export default async function EducationRequests({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { services } = await requirePageUser(true);
  const page = educationPageSchema.safeParse(await searchParams);
  if (!page.success)
    return (
      <>
        <h1>Education requests</h1>
        <p>Invalid filters.</p>
        <Link href="/admin/education">Return to requests</Link>
      </>
    );
  const requests = await services.education.list(page.data);
  return (
    <>
      <p className="eyebrow">EDUCATION ENQUIRIES</p>
      <h1>Education requests</h1>
      <p>
        Consented contact details supplied by visitors. Review the request and
        contact the person through your approved process; no email or WhatsApp
        is sent automatically.
      </p>
      <form className="button-row" method="get">
        <label className="field">
          Preferred service
          <select name="service" defaultValue={page.data.service}>
            <option value="all">All services</option>
            {Object.entries(educationServices).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="button button-outline">Filter requests</button>
      </form>
      {!requests.length && (
        <div className="empty-state">
          <h2>No education requests</h2>
          <p>New requests will appear here after submission.</p>
        </div>
      )}
      <div className="education-requests">
        {requests.map((item) => (
          <article className="panel education-request" key={item.id}>
            <p className="eyebrow">{educationServices[item.service]}</p>
            <h2>{item.name}</h2>
            <dl className="detail-list">
              <div>
                <dt>Email</dt>
                <dd>{item.email}</dd>
              </div>
              <div>
                <dt>Phone / WhatsApp</dt>
                <dd>{item.phone}</dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>{formatDate(item.createdAt)}</dd>
              </div>
              <div>
                <dt>Reference</dt>
                <dd>{item.id}</dd>
              </div>
            </dl>
            <h3>Message or query</h3>
            <p className="education-message">
              {item.message || "No message supplied."}
            </p>
          </article>
        ))}
      </div>
      <nav aria-label="Education request pages" className="button-row">
        {page.data.offset > 0 && (
          <Link
            href={`/admin/education?service=${page.data.service}&offset=${Math.max(0, page.data.offset - 50)}`}
          >
            ← Previous
          </Link>
        )}
        {requests.length === 50 && (
          <Link
            href={`/admin/education?service=${page.data.service}&offset=${page.data.offset + 50}`}
          >
            Next →
          </Link>
        )}
      </nav>
    </>
  );
}
