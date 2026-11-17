import Link from "next/link";
import { requirePageUser } from "@/server/page-auth";
import { announcementPageSchema } from "@/lib/announcement-inputs";
import { AnnouncementEditor } from "@/components/announcement-editor";
export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { services } = await requirePageUser(true);
  const page = announcementPageSchema.safeParse(await searchParams);
  if (!page.success)
    return (
      <>
        <h1>Announcements</h1>
        <p>Invalid page.</p>
        <Link href="/admin/announcements">Return to announcements</Link>
      </>
    );
  const announcements = await services.announcements.manage(page.data);
  const clients = await services.clients.list();
  const options = clients.map(({ id, clientId, displayName, status }) => ({
    id,
    clientId,
    displayName,
    status,
  }));
  return (
    <>
      <p className="eyebrow">PRIVATE CLIENT COMMUNICATION</p>
      <h1>Announcements</h1>
      <p>
        Create a draft, choose recipients, then publish. Notifications stay in
        the client portal; no email is sent. Drafts and archived notices are
        hidden from clients.
      </p>
      <details className="panel">
        <summary>Create announcement</summary>
        <AnnouncementEditor initialClients={options} />
      </details>
      {announcements.length === 0 && <p>No announcements on this page.</p>}
      {announcements.map((notice) => (
        <details className="panel" key={`${notice.id}:${notice.version}`}>
          <summary>
            {notice.title} · {notice.status} · version {notice.version}
          </summary>
          <p>
            {
              notice.recipients.filter((r) => r.readVersion === notice.version)
                .length
            }{" "}
            of {notice.recipients.length} recipients marked this version as
            read.
          </p>
          <AnnouncementEditor announcement={notice} initialClients={options} />
        </details>
      ))}
      <nav aria-label="Announcement pages" className="button-row">
        {page.data.offset > 0 && (
          <Link
            href={`/admin/announcements?offset=${Math.max(0, page.data.offset - 50)}`}
          >
            ← Previous
          </Link>
        )}
        {announcements.length === 50 && (
          <Link href={`/admin/announcements?offset=${page.data.offset + 50}`}>
            Next →
          </Link>
        )}
      </nav>
    </>
  );
}
