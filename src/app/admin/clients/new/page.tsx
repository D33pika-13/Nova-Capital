import Link from "next/link";
import { requirePageUser } from "@/server/page-auth";
import { CreateClientForm } from "@/components/client-forms";
export default async function NewClient() {
  await requirePageUser(true);
  return (
    <>
      <Link className="text-link" href="/admin/clients">
        ← Clients
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">NEW CLIENT RECORD</p>
          <h1>Create a client</h1>
        </div>
      </div>
      <section className="panel form-panel">
        <CreateClientForm />
      </section>
    </>
  );
}
