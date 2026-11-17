import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/page-auth";
import { announcementPageSchema } from "@/lib/announcement-inputs";
import { AnnouncementInbox } from "@/components/announcement-inbox";
export const dynamic = "force-dynamic";
export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { services, context } = await requirePageUser();
  if (context.profile.role === "admin") redirect("/admin");
  const page = announcementPageSchema.safeParse(await searchParams);
  if (!page.success)
    return (
      <section className="container section">
        <h1>Announcements</h1>
        <p>Invalid page.</p>
        <Link href="/portal/announcements">Return to announcements</Link>
      </section>
    );
  const announcements = await services.announcements.inbox(page.data);
  return (
    <section className="container section">
      <Link className="text-link" href="/portal">
        ← Portfolio
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{context.profile.clientId}</p>
          <h1>Announcements</h1>
          <p>
            Notices addressed to your account. An edited notice appears unread
            until you mark its current version as read.
          </p>
        </div>
      </div>
      <AnnouncementInbox announcements={announcements} />
      <nav aria-label="Announcement pages" className="button-row">
        {page.data.offset > 0 && (
          <Link
            href={`/portal/announcements?offset=${Math.max(0, page.data.offset - 50)}`}
          >
            ← Previous
          </Link>
        )}
        {announcements.length === 50 && (
          <Link href={`/portal/announcements?offset=${page.data.offset + 50}`}>
            Next →
          </Link>
        )}
      </nav>
    </section>
  );
}
