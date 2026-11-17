import "server-only";
import type { Database } from "../database";
import type { AuthorizedContext } from "../modules/identity/authorization-service";
import type { OfferRepository } from "../modules/offers/offer-service";
import type { Offer, OfferInput, OfferEditInput } from "@/lib/offer-inputs";
import { MutationStore } from "../mutation-store";
import { AppError } from "../errors";
export const offerColumns = `id,title,description,category,eligibility,terms,status,version,to_char(starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "startsAt",to_char(ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "endsAt",(select jsonb_build_object('id',i.id,'alt',i.alt,'width',i.width,'height',i.height) from public.offer_images i where i.id=offers.image_id and i.status='ready') as image`;
export class PostgresOfferRepository implements OfferRepository {
  private readonly mutations: MutationStore;
  constructor(private readonly db: Database) {
    this.mutations = new MutationStore(db);
  }
  async list(context: AuthorizedContext | null) {
    return this.db.withIdentity(
      context?.identity ?? null,
      async (sql) =>
        (
          await sql.query<Offer>(
            `select ${offerColumns} from public.offers order by starts_at desc,id limit 200`,
          )
        ).rows,
    );
  }
  async save(
    context: AuthorizedContext,
    input: OfferInput | OfferEditInput,
    id?: string,
  ) {
    return this.mutations.run(
      context,
      input.requestId,
      "offer.save",
      { ...input, id },
      async (sql) => {
        const values = [
          input.title,
          input.description,
          input.category,
          input.eligibility,
          input.terms,
          input.status,
          input.startsAt,
          input.endsAt,
        ];
        const result = id
          ? await sql.query<Offer>(
              `update public.offers set title=$1,description=$2,category=$3,eligibility=$4,terms=$5,status=$6,starts_at=$7,ends_at=$8 where id=$9 and version=$10 returning ${offerColumns}`,
              [...values, id, (input as OfferEditInput).expectedVersion],
            )
          : await sql.query<Offer>(
              `insert into public.offers(title,description,category,eligibility,terms,status,starts_at,ends_at,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${offerColumns}`,
              [...values, context.profile.id],
            );
        if (!result.rows[0])
          throw new AppError(
            "STALE_RECORD",
            "Offer changed or is unavailable. Refresh before editing.",
            409,
          );
        return result.rows[0];
      },
    );
  }
}
