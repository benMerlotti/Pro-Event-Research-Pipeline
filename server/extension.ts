import { randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { Query } from "firebase-admin/firestore";
import type { GoogleGenAI } from "@google/genai";
import { getAdminDb, getAdminAuth } from "./firebaseAdmin.js";
import { resolveExtensionAuth, extensionCors } from "./extensionAuth.js";
import { BUILT_IN_TEMPLATE, DEFAULT_SUBJECT, applyReplacements, type ExtensionTemplate } from "./templates.js";
import { isLeadMatch } from "../src/lib/leadMatching.js";

// Templates available to an extension user: the built-in default, every shared
// (admin-created) template, and that user's own personal templates.
async function loadTemplatesForUser(uid: string): Promise<ExtensionTemplate[]> {
  const db = await getAdminDb();
  const [shared, personal] = await Promise.all([
    db.collection("shared_templates").get(),
    db.collection("users").doc(uid).collection("templates").get(),
  ]);
  const mapDoc = (d: FirebaseFirestore.QueryDocumentSnapshot): ExtensionTemplate => ({
    id: d.id,
    name: (d.data().name as string) ?? "Untitled",
    subject: (d.data().subject as string) ?? DEFAULT_SUBJECT,
    text: (d.data().text as string) ?? "",
  });
  return [BUILT_IN_TEMPLATE, ...shared.docs.map(mapDoc), ...personal.docs.map(mapDoc)];
}

// Vance's pipeline uses a 3-state status; the extension UI speaks the original
// outreach enum. Map between them so sidepanel.js renders without changes.
const STATUS_TO_OUTREACH: Record<string, string> = {
  Initial: "NOT_STARTED",
  Contacted: "CONTACTED",
  Responded: "RESPONDED",
};

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

// Shape a Firestore event doc into the { event, contacts } item the side panel
// expects. EventContact has no stable id, so we synthesize one from its index.
function toQueueItem(id: string, e: any) {
  const contacts = Array.isArray(e.contacts) ? e.contacts : [];
  return {
    event: {
      id,
      name: e.eventName ?? "",
      city: e.location ?? "",
      state: "",
      startDate: e.date ?? null,
      endDate: null,
      website: e.website ?? "",
      outreachStatus: STATUS_TO_OUTREACH[e.status] ?? "NOT_STARTED",
    },
    contacts: contacts
      .filter((c: any) => c && (c.email || c.name))
      .map((c: any, i: number) => {
        const { firstName, lastName } = splitName(c.name);
        return {
          id: `${id}:${i}`,
          firstName,
          lastName,
          email: c.email ?? "",
          title: c.role ?? "",
        };
      }),
  };
}

export function registerExtensionRoutes(app: Express, ai: GoogleGenAI) {
  app.use("/api/extension", extensionCors);

  // POST /api/extension/issue-key — called from the web app (not the extension)
  // so a signed-in user can reveal/generate their own extension key. Auth is the
  // Firebase ID token, NOT x-extension-key. One key per (uid, projectId): reveals
  // the existing one or mints a new one.
  app.post("/api/extension/issue-key", async (req: Request, res: Response) => {
    try {
      const header = req.header("authorization") ?? "";
      const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!idToken) return res.status(401).json({ error: "Missing ID token" });

      let uid: string;
      let tokenName = "";
      try {
        const adminAuth = await getAdminAuth();
        const decoded = await adminAuth.verifyIdToken(idToken);
        uid = decoded.uid;
        tokenName = (decoded.name as string) ?? "";
      } catch (e: any) {
        console.error("[extension/issue-key] token verification failed:", e?.message ?? e);
        return res.status(401).json({ error: "Invalid ID token" });
      }

      const projectId = req.body?.projectId;
      if (!projectId) return res.status(400).json({ error: "projectId is required" });

      const db = await getAdminDb();
      // Defense in depth: the project must belong to the authenticated user.
      const project = await db
        .collection("users")
        .doc(uid)
        .collection("projects")
        .doc(projectId)
        .get();
      if (!project.exists) return res.status(404).json({ error: "Project not found" });

      // Single-field query (auto-indexed); match projectId in memory to avoid a
      // composite index. Reveal the existing key or mint a fresh one.
      const owned = await db.collection("extension_keys").where("uid", "==", uid).get();
      const match = owned.docs.find((d) => d.data().projectId === projectId);

      let key: string;
      if (match) {
        key = match.id;
      } else {
        key = `ext_${randomBytes(24).toString("hex")}`;
        await db.collection("extension_keys").doc(key).set({
          uid,
          projectId,
          senderName: tokenName,
          companyName: "Druid Productions",
          companyWebsite: "",
          createdAt: new Date().toISOString(),
        });
      }

      res.json({ key, projectId, projectName: project.data()?.name ?? "" });
    } catch (err: any) {
      console.error("[extension/issue-key]", err);
      res.status(500).json({ error: err.message ?? "Failed to issue key" });
    }
  });

  // GET /api/extension/me — sender identity for email templates.
  app.get("/api/extension/me", async (req: Request, res: Response) => {
    try {
      const auth = await resolveExtensionAuth(req);
      if (!auth) return res.status(401).json({ error: "Unauthorized" });

      // Prefer the per-key sender name; fall back to the user's display name.
      let senderName = auth.senderName;
      if (!senderName) {
        const adminDb = await getAdminDb();
        const user = await adminDb.collection("users").doc(auth.uid).get();
        senderName = user.data()?.displayName ?? "";
      }

      res.json({
        senderName,
        companyName: auth.companyName,
        companyWebsite: auth.companyWebsite,
      });
    } catch (err: any) {
      console.error("[extension/me]", err);
      res.status(500).json({ error: err.message ?? "Failed to load profile" });
    }
  });

  // GET /api/extension/queue[?all=1] — events with contacts to work through.
  app.get("/api/extension/queue", async (req: Request, res: Response) => {
    try {
      const auth = await resolveExtensionAuth(req);
      if (!auth) return res.status(401).json({ error: "Unauthorized" });

      const showAll = req.query.all === "1";
      const adminDb = await getAdminDb();
      const eventsRef = adminDb
        .collection("users")
        .doc(auth.uid)
        .collection("projects")
        .doc(auth.projectId)
        .collection("events");

      // Equality-only filter needs no composite index; sort in memory since the
      // `date` field is a free-text string (and can describe a vendor, not a date).
      const query: Query = showAll
        ? eventsRef
        : eventsRef.where("status", "==", "Initial");
      const snap = await query.get();

      const items = snap.docs
        .map((doc) => toQueueItem(doc.id, doc.data()))
        .filter((item) => item.contacts.length > 0)
        .sort((a, b) =>
          String(a.event.startDate ?? "").localeCompare(String(b.event.startDate ?? ""))
        );

      res.json({ items });
    } catch (err: any) {
      console.error("[extension/queue]", err);
      res.status(500).json({ error: err.message ?? "Failed to load queue" });
    }
  });

  // GET /api/extension/templates — built-in + shared + the user's personal templates.
  app.get("/api/extension/templates", async (req: Request, res: Response) => {
    const auth = await resolveExtensionAuth(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });
    try {
      const templates = await loadTemplatesForUser(auth.uid);
      res.json({
        templates: templates.map((t) => ({
          id: t.id,
          name: t.name,
          subject: t.subject,
          bodyText: t.text,
        })),
      });
    } catch (err: any) {
      console.error("[extension/templates]", err);
      res.status(500).json({ error: err.message ?? "Failed to load templates" });
    }
  });

  // POST /api/extension/generate — fill the template for this event/contact, then
  // lightly humanize it with Gemini. Falls back to the plain interpolated text.
  app.post("/api/extension/generate", async (req: Request, res: Response) => {
    const auth = await resolveExtensionAuth(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { event, contact, templateId, senderName } = req.body ?? {};
      const templates = await loadTemplatesForUser(auth.uid);
      const template = templates.find((t) => t.id === templateId);
      if (!template) return res.status(404).json({ error: "Template not found" });

      const contactName = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ");
      const replacements = {
        eventName: event?.name ?? "",
        contactName,
        location: event?.city ?? "",
        date: event?.startDate ?? "",
        salesperson: senderName ?? "",
      };
      const interpolated = applyReplacements(template.text, replacements);
      const subject = applyReplacements(template.subject, replacements);

      let email = interpolated;
      try {
        const prompt = `Below is an outreach email that has been filled in with specific event details. Rewrite it slightly so it reads as a natural, personal email - vary a word or phrase here and there and keep the tone genuine, but keep the same core message, length, and structure. Do not add or remove information. Do not add a subject line. Do not use em dashes. Return only the email body as plain text.

Event: ${replacements.eventName}
Contact: ${contactName || "the organizer"}

Email:
${interpolated}`;
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
        });
        const text = response.text?.trim();
        if (text) email = text;
      } catch (e: any) {
        console.error("[extension/generate] Gemini humanize failed, using template:", e?.message ?? e);
      }

      res.json({ email, subject });
    } catch (err: any) {
      console.error("[extension/generate]", err);
      res.status(500).json({ error: err.message ?? "Failed to generate" });
    }
  });

  // POST /api/extension/mark-sent — flip the event to Contacted and sync the
  // user's matching claimed_leads, mirroring PipelineMode.updateStatus.
  app.post("/api/extension/mark-sent", async (req: Request, res: Response) => {
    const auth = await resolveExtensionAuth(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { eventId } = req.body ?? {};
      if (!eventId) return res.status(400).json({ error: "eventId is required" });

      const db = await getAdminDb();
      const eventRef = db
        .collection("users")
        .doc(auth.uid)
        .collection("projects")
        .doc(auth.projectId)
        .collection("events")
        .doc(eventId);
      const eventSnap = await eventRef.get();
      if (!eventSnap.exists) return res.status(404).json({ error: "Event not found" });
      const e = eventSnap.data() as any;

      await eventRef.update({ status: "Contacted", responseOutcome: null, contactMethod: "Email" });

      // Sync this user's matching claim records (same matching the web app uses).
      const claims = await db.collection("claimed_leads").where("claimedBy", "==", auth.uid).get();
      const matches = claims.docs.filter((d) =>
        isLeadMatch(
          { eventName: e.eventName, website: e.website },
          { eventName: d.data().eventName, website: d.data().website }
        )
      );
      // Stamp contactedAt so the weekly leaderboard can count this outreach.
      const contactedAt = new Date();
      await Promise.all(matches.map((d) => d.ref.update({ status: "Contacted", responseOutcome: null, contactedAt })));

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[extension/mark-sent]", err);
      res.status(500).json({ error: err.message ?? "Failed to mark sent" });
    }
  });
}
