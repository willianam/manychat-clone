import { describe, it, expect } from "vitest";
import {
  MEDIA_FIELDS,
  mediaLabel,
  parseMediaItem,
  parseMediaList,
  type IgMedia,
} from "../ig-media";

/**
 * Guards the parsing of `GET /me/media`.
 *
 * This is the shape that would break silently on an API version bump: the
 * post selector would just render empty and the owner would conclude they
 * have no posts, rather than seeing an error.
 */

/** A response shaped like the real one, with all three media types. */
const REAL_RESPONSE = {
  data: [
    {
      id: "17900000000000001",
      caption: "Promo de setembro 🔥 comenta QUERO",
      media_type: "IMAGE",
      media_url: "https://cdn.example/img1.jpg",
      permalink: "https://www.instagram.com/p/AAA/",
      timestamp: "2026-08-10T12:00:00+0000",
    },
    {
      id: "17900000000000002",
      caption: "",
      media_type: "VIDEO",
      media_url: "https://cdn.example/video.mp4",
      thumbnail_url: "https://cdn.example/thumb.jpg",
      permalink: "https://www.instagram.com/reel/BBB/",
      timestamp: "2026-08-09T12:00:00+0000",
    },
    {
      id: "17900000000000003",
      media_type: "CAROUSEL_ALBUM",
      media_url: "https://cdn.example/album.jpg",
    },
  ],
  paging: { cursors: { before: "x", after: "y" } },
};

describe("parseMediaList", () => {
  it("parses a real-shaped response into clean items", () => {
    const list = parseMediaList(REAL_RESPONSE);
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual<IgMedia>({
      id: "17900000000000001",
      caption: "Promo de setembro 🔥 comenta QUERO",
      mediaType: "IMAGE",
      thumbnailUrl: "https://cdn.example/img1.jpg",
      permalink: "https://www.instagram.com/p/AAA/",
      timestamp: "2026-08-10T12:00:00+0000",
    });
  });

  it("prefers thumbnail_url for a video but falls back to media_url", () => {
    const list = parseMediaList(REAL_RESPONSE);
    // VIDEO: thumbnail_url wins over media_url (which is the .mp4).
    expect(list[1]?.thumbnailUrl).toBe("https://cdn.example/thumb.jpg");
    // CAROUSEL_ALBUM: no thumbnail_url exists, so media_url is the still.
    expect(list[2]?.thumbnailUrl).toBe("https://cdn.example/album.jpg");
  });

  it("treats a missing caption as empty rather than undefined", () => {
    const list = parseMediaList(REAL_RESPONSE);
    expect(list[2]?.caption).toBe("");
  });

  it("drops malformed items instead of failing the whole list", () => {
    const list = parseMediaList({
      data: [
        { id: "keep-me", media_type: "IMAGE" },
        { caption: "no id at all" },
        null,
        "not an object",
        { id: "   " },
      ],
    });
    expect(list.map((m) => m.id)).toEqual(["keep-me"]);
  });

  it("returns an empty list for anything that is not a media response", () => {
    expect(parseMediaList(null)).toEqual([]);
    expect(parseMediaList({})).toEqual([]);
    expect(parseMediaList({ data: "nope" })).toEqual([]);
    expect(parseMediaList({ error: { message: "Invalid token" } })).toEqual([]);
  });

  it("keeps an unknown media_type as null rather than guessing", () => {
    const item = parseMediaItem({ id: "x", media_type: "STORY" });
    expect(item?.mediaType).toBeNull();
  });

  it("asks Meta for every field the picker renders", () => {
    for (const field of [
      "id",
      "caption",
      "media_type",
      "media_url",
      "thumbnail_url",
      "permalink",
      "timestamp",
    ]) {
      expect(MEDIA_FIELDS.split(",")).toContain(field);
    }
  });
});

describe("mediaLabel", () => {
  const base: IgMedia = {
    id: "1",
    caption: "",
    mediaType: "IMAGE",
    thumbnailUrl: null,
    permalink: null,
    timestamp: null,
  };

  it("uses the first non-empty caption line", () => {
    expect(mediaLabel({ ...base, caption: "\n\nPromo de setembro\nsegunda linha" })).toBe(
      "Promo de setembro",
    );
  });

  it("truncates a long caption so the picker stays one line per post", () => {
    const label = mediaLabel({ ...base, caption: "a".repeat(200) });
    expect(label).toHaveLength(80);
    expect(label.endsWith("…")).toBe(true);
  });

  it("names the type instead of showing a bare id when there is no caption", () => {
    expect(mediaLabel({ ...base, mediaType: "VIDEO" })).toBe("Reel sem legenda");
    expect(mediaLabel({ ...base, mediaType: "CAROUSEL_ALBUM" })).toBe("Carrossel sem legenda");
    expect(mediaLabel({ ...base, mediaType: "IMAGE" })).toBe("Foto sem legenda");
    expect(mediaLabel({ ...base, mediaType: null })).toBe("Publicação sem legenda");
  });
});
