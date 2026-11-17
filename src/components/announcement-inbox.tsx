import type { ClientAnnouncement } from "@/lib/announcement-inputs";
import { AnnouncementReadButton } from "./announcement-read-button";
export function AnnouncementInbox({
  announcements,
}: {
  announcements: ClientAnnouncement[];
}) {
  if (!announcements.length)
    return <p>No published announcements are addressed to your account.</p>;
  return (
    <div className="form-stack">
      {announcements.map((notice) => {
        const isRead = notice.readVersion === notice.version;
        return (
          <article className="panel" key={`${notice.id}:${notice.version}`}>
            <span className="badge">{isRead ? "Read" : "Unread"}</span>
            <h2>{notice.title}</h2>
            <p className="small muted">
              Updated {notice.updatedAt} · version {notice.version}
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>{notice.body}</p>
            {isRead ? (
              <p className="small muted">Marked as read at {notice.readAt}.</p>
            ) : (
              <AnnouncementReadButton id={notice.id} version={notice.version} />
            )}
          </article>
        );
      })}
    </div>
  );
}
