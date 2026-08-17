import Link from "next/link";
import { db } from "../../server/db";

export const dynamic = "force-dynamic";

export default async function FlowsPage() {
  const flows = await db.flow.findMany({ include: { triggers: true } });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Fluxos</h1>
      <ul className="mt-4 space-y-2">
        {flows.map((f) => (
          <li key={f.id} className="rounded-lg border bg-white p-4">
            <Link href={`/flows/${f.id}`} className="font-medium hover:underline">
              {f.name}
            </Link>
            <div className="mt-1 text-xs text-neutral-500">
              {f.triggers.map((t) => `${t.kind.toLowerCase()}: "${t.pattern}"`).join(" · ")}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
