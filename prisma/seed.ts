import { PrismaClient } from "@prisma/client";

/**
 * Seeds a working demo: two tags, three contacts (one inside the 24h
 * window, one outside, one that never wrote), and a welcome flow wired to
 * the keyword "oi" plus a comment trigger on "quero".
 *
 * The out-of-window contact is deliberate — it makes the broadcast report
 * show a real "skipped" line on the first run instead of a suspiciously
 * perfect one.
 */

const db = new PrismaClient();

async function main() {
  const lead = await db.tag.upsert({
    where: { name: "lead" },
    create: { name: "lead", color: "#6366f1" },
    update: {},
  });
  await db.tag.upsert({
    where: { name: "cliente" },
    create: { name: "cliente", color: "#10b981" },
    update: {},
  });

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  const ana = await db.contact.upsert({
    where: { igScopedId: "demo-ana" },
    create: {
      igScopedId: "demo-ana",
      username: "ana.demo",
      name: "Ana",
      lastInboundAt: hoursAgo(2), // inside the window
    },
    update: {},
  });

  await db.contact.upsert({
    where: { igScopedId: "demo-bruno" },
    create: {
      igScopedId: "demo-bruno",
      username: "bruno.demo",
      name: "Bruno",
      lastInboundAt: hoursAgo(50), // outside — broadcast will skip
    },
    update: {},
  });

  await db.contact.upsert({
    where: { igScopedId: "demo-carla" },
    create: {
      igScopedId: "demo-carla",
      username: "carla.demo",
      name: "Carla",
      lastInboundAt: null, // never messaged — cannot be contacted
    },
    update: {},
  });

  await db.contactTag.upsert({
    where: { contactId_tagId: { contactId: ana.id, tagId: lead.id } },
    create: { contactId: ana.id, tagId: lead.id },
    update: {},
  });

  const graph = {
    nodes: [
      {
        id: "n1",
        type: "message",
        position: { x: 250, y: 0 },
        data: { kind: "message", text: "Oi! Que bom te ver por aqui 👋" },
      },
      {
        id: "n2",
        type: "question",
        position: { x: 250, y: 120 },
        data: { kind: "question", text: "Como posso te chamar?", saveAs: "nome" },
      },
      {
        id: "n3",
        type: "tag",
        position: { x: 250, y: 240 },
        data: { kind: "tag", action: "add", tagName: "lead" },
      },
      {
        id: "n4",
        type: "condition",
        position: { x: 250, y: 360 },
        data: { kind: "condition", key: "nome", op: "exists" },
      },
      {
        id: "n5",
        type: "message",
        position: { x: 80, y: 480 },
        data: { kind: "message", text: "Prazer, {{nome}}! Já te anotei aqui." },
      },
      {
        id: "n6",
        type: "message",
        position: { x: 420, y: 480 },
        data: { kind: "message", text: "Sem problema, seguimos!" },
      },
      { id: "n7", type: "end", position: { x: 250, y: 600 }, data: { kind: "end" } },
    ],
    edges: [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n3" },
      { id: "e3", source: "n3", target: "n4" },
      { id: "e4", source: "n4", target: "n5", sourceHandle: "true" },
      { id: "e5", source: "n4", target: "n6", sourceHandle: "false" },
      { id: "e6", source: "n5", target: "n7" },
      { id: "e7", source: "n6", target: "n7" },
    ],
  };

  const existing = await db.flow.findFirst({ where: { name: "Boas-vindas" } });
  const flow = existing
    ? await db.flow.update({ where: { id: existing.id }, data: { graph, enabled: true } })
    : await db.flow.create({ data: { name: "Boas-vindas", enabled: true, graph } });

  await db.trigger.deleteMany({ where: { flowId: flow.id } });
  await db.trigger.createMany({
    data: [
      { flowId: flow.id, kind: "KEYWORD", pattern: "oi", match: "CONTAINS", priority: 10 },
      { flowId: flow.id, kind: "COMMENT", pattern: "quero", match: "CONTAINS", priority: 10 },
    ],
  });

  console.log("Seed done: 3 contacts, 2 tags, flow 'Boas-vindas' with 2 triggers.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
