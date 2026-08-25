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
        position: { x: 0, y: 0 },
        data: {
          kind: "message",
          text: "Oi! Que bom te ver por aqui 👋\n\nO que você quer ver primeiro?",
          buttons: [
            { type: "postback", id: "b-planos", title: "Ver planos" },
            { type: "postback", id: "b-duvida", title: "Tirar dúvida" },
          ],
        },
      },
      {
        id: "n2",
        type: "carousel",
        position: { x: -260, y: 260 },
        data: {
          kind: "carousel",
          expanded: true,
          cards: [
            {
              id: "c1",
              title: "Básico",
              subtitle: "R$ 97/mês",
              buttons: [{ type: "postback", id: "b-c1", title: "Quero este" }],
            },
            {
              id: "c2",
              title: "Pro",
              subtitle: "R$ 197/mês",
              buttons: [{ type: "postback", id: "b-c2", title: "Quero este" }],
            },
            {
              id: "c3",
              title: "Premium",
              subtitle: "R$ 397/mês",
              buttons: [{ type: "postback", id: "b-c3", title: "Quero este" }],
            },
          ],
        },
      },
      {
        id: "n3",
        type: "quickreply",
        position: { x: 280, y: 260 },
        data: {
          kind: "quickreply",
          text: "Sobre o que é sua dúvida?",
          saveAs: "assunto",
          options: [
            { id: "q1", title: "Preço" },
            { id: "q2", title: "Como funciona" },
            { id: "q3", title: "Outro" },
          ],
        },
      },
      {
        id: "n4",
        type: "action",
        position: { x: -260, y: 560 },
        data: {
          kind: "action",
          ops: [
            { op: "addTag", tagName: "interessado" },
            { op: "setField", key: "origem", value: "instagram", valueType: "text" },
          ],
        },
      },
      {
        id: "n5",
        type: "delay",
        position: { x: -260, y: 720 },
        data: { kind: "delay", seconds: 3600, window: { fromHour: 8, toHour: 22 } },
      },
      {
        id: "n6",
        type: "message",
        position: { x: -260, y: 860 },
        data: { kind: "message", text: "Ficou alguma dúvida sobre o plano?" },
      },
      {
        id: "n7",
        type: "message",
        position: { x: 280, y: 560 },
        data: { kind: "message", text: "Boa! Já te respondo sobre {{assunto}}." },
      },
      { id: "n8", type: "end", position: { x: 0, y: 1020 }, data: { kind: "end" } },
    ],
    edges: [
      { id: "e1", source: "n1", target: "n2", sourceHandle: "b-planos" },
      { id: "e2", source: "n1", target: "n3", sourceHandle: "b-duvida" },
      { id: "e3", source: "n2", target: "n4", sourceHandle: "b-c1" },
      { id: "e4", source: "n2", target: "n4", sourceHandle: "b-c2" },
      { id: "e5", source: "n2", target: "n4", sourceHandle: "b-c3" },
      { id: "e6", source: "n4", target: "n5" },
      { id: "e7", source: "n5", target: "n6" },
      { id: "e8", source: "n6", target: "n8" },
      { id: "e9", source: "n3", target: "n7", sourceHandle: "q1" },
      { id: "e10", source: "n3", target: "n7", sourceHandle: "q2" },
      { id: "e11", source: "n3", target: "n7", sourceHandle: "q3" },
      { id: "e12", source: "n7", target: "n8" },
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
