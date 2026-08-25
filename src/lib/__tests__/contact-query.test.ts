import { describe, expect, it } from "vitest";
import { hasFilters, parseContactQuery, serializeContactQuery, withQuery } from "../contact-query";

describe("parseContactQuery", () => {
  it("defaults to last interaction, newest first, page 1", () => {
    expect(parseContactQuery({})).toEqual({
      q: "",
      tags: [],
      subscribed: undefined,
      window: undefined,
      source: undefined,
      segment: undefined,
      sort: "lastInbound",
      dir: "desc",
      page: 1,
    });
  });

  it("reads every filter, repeated and comma-joined tags included", () => {
    const q = parseContactQuery({
      q: " ana ",
      tag: ["t1", "t2,t3"],
      subscribed: "false",
      window: "in",
      source: "ref:promo",
      segment: "s1",
      sort: "name",
      page: "3",
    });
    expect(q.q).toBe("ana");
    expect(q.tags).toEqual(["t1", "t2", "t3"]);
    expect(q.subscribed).toBe(false);
    expect(q.window).toBe("in");
    expect(q.source).toBe("ref:promo");
    expect(q.segment).toBe("s1");
    expect(q.sort).toBe("name");
    expect(q.dir).toBe("asc");
    expect(q.page).toBe(3);
  });

  it("ignores junk", () => {
    const q = parseContactQuery({ sort: "hack", dir: "sideways", page: "-2", window: "maybe" });
    expect(q.sort).toBe("lastInbound");
    expect(q.dir).toBe("desc");
    expect(q.page).toBe(1);
    expect(q.window).toBeUndefined();
  });
});

describe("serializeContactQuery", () => {
  it("is empty for the default view", () => {
    expect(serializeContactQuery(parseContactQuery({}))).toBe("");
  });

  it("round-trips through parse", () => {
    const q = parseContactQuery({
      q: "ana",
      tag: ["t1", "t2"],
      subscribed: "true",
      window: "out",
      sort: "createdAt",
      dir: "asc",
      page: "2",
    });
    const s = serializeContactQuery(q);
    expect(s).toBe("?q=ana&tag=t1&tag=t2&subscribed=true&window=out&sort=createdAt&dir=asc&page=2");
    const back = parseContactQuery(Object.fromEntries(new URLSearchParams(s)));
    // URLSearchParams collapses repeated keys to the last one; feed all values.
    back.tags = new URLSearchParams(s).getAll("tag");
    expect(back).toEqual(q);
  });

  it("omits a dir that is the sort's default", () => {
    expect(serializeContactQuery({ sort: "name", dir: "asc" })).toBe("?sort=name");
    expect(serializeContactQuery({ sort: "name", dir: "desc" })).toBe("?sort=name&dir=desc");
  });
});

describe("withQuery / hasFilters", () => {
  it("resets the page when a filter changes, unless the patch sets it", () => {
    const base = { ...parseContactQuery({}), page: 4 };
    expect(withQuery(base, { window: "in" }).page).toBe(1);
    expect(withQuery(base, { page: 5 }).page).toBe(5);
  });

  it("knows when the view is filtered", () => {
    expect(hasFilters(parseContactQuery({}))).toBe(false);
    expect(hasFilters(parseContactQuery({ sort: "name" }))).toBe(false);
    expect(hasFilters(parseContactQuery({ tag: "t1" }))).toBe(true);
    expect(hasFilters(parseContactQuery({ subscribed: "false" }))).toBe(true);
  });
});
