import { renderToStaticMarkup } from "react-dom/server";
import { it, expect, vi } from "vitest";
import { AnnouncementInbox } from "@/components/announcement-inbox";
import { AnnouncementEditor } from "@/components/announcement-editor";
import type { ClientAnnouncement } from "@/lib/announcement-inputs";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const notice: ClientAnnouncement = {
  id: "synthetic-notice",
  title: "<script>unsafe</script>",
  body: "<img src=x onerror=alert(1)>",
  version: 2,
  updatedAt: "2026-11-11T00:00:00Z",
  readVersion: 1,
  readAt: "2026-11-10T00:00:00Z",
};
it("shows honest empty and unread-version states with escaped content", () => {
  expect(
    renderToStaticMarkup(<AnnouncementInbox announcements={[]} />),
  ).toContain("No published announcements are addressed to your account");
  const html = renderToStaticMarkup(
    <AnnouncementInbox announcements={[notice]} />,
  );
  expect(html).toContain("Unread");
  expect(html).toContain("Mark as read");
  expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<img");
});
it("shows acknowledged current versions without another read button", () => {
  const html = renderToStaticMarkup(
    <AnnouncementInbox announcements={[{ ...notice, readVersion: 2 }]} />,
  );
  expect(html).toContain("Marked as read at");
  expect(html).not.toContain("Mark as read</button>");
});
it("labels recipient selection, publication and the no-email boundary", () => {
  const html = renderToStaticMarkup(
    <AnnouncementEditor
      initialClients={[
        {
          id: "client-a",
          clientId: "INV-1001",
          displayName: "<b>Fixture</b>",
          status: "active",
        },
      ]}
    />,
  );
  expect(html).toContain("Recipients (0/200)");
  expect(html).toContain("INV-1001");
  expect(html).toContain("No email is sent");
  expect(html).toContain("Publication status");
  expect(html).toContain("&lt;b&gt;Fixture&lt;/b&gt;");
  expect(html).toContain('type="checkbox"');
});
