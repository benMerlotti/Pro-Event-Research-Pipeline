import React, { useState, useEffect, useRef } from "react";
import { SavedEvent, ResponseOutcome } from "@/src/types";
import {
  Calendar,
  MapPin,
  ChevronDown,
  ChevronRight,
  Trash2,
  Users,
  Mail,
  Phone,
  Link as LinkIcon,
  MessageSquare,
  Zap,
  Info,
  Bookmark,
  Briefcase,
  Maximize2,
  Minimize2,
  Share2,
  Copy,
  Edit3,
  Check,
  X,
  Plus,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion } from "motion/react";
import { useFirebase } from "./FirebaseProvider";
import { useTemplates, EmailTemplate } from "@/src/lib/useTemplates";

const formatDate = (raw: string): string => {
  if (!raw) return '';
  const rangeParts = raw.split(' – ');
  if (rangeParts.length === 2) {
    const [s, e] = rangeParts.map(p => new Date(p.trim() + 'T00:00:00'));
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return raw;
    if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
      return `${s.toLocaleDateString('en-US', { month: 'long' })} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`;
    }
    return `${s.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
  }
  const d = new Date(raw + 'T00:00:00');
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

const generateLocalVariationsClient = (text: string): string[] => {
  const greetings = [
    {
      target: "Hi [Contact Name]",
      alts: [
        "Hello [Contact Name]",
        "Dear [Contact Name]",
        "Hey [Contact Name]",
        "Greetings [Contact Name]",
      ],
    },
    {
      target: "Hi [Contact Name],",
      alts: [
        "Hello [Contact Name],",
        "Dear [Contact Name],",
        "Hey [Contact Name],",
        "Greetings [Contact Name],",
      ],
    },
    {
      target: "I hope you are having an excellent week",
      alts: [
        "I hope you're having a great week",
        "Hope you're having a wonderful week",
        "Hope you are having a productive week",
        "Hope your week is off to a great start",
      ],
    },
    {
      target: "Hi procurement team",
      alts: [
        "Hello procurement team",
        "To the procurement team",
        "Hi [Vendor Name] procurement",
        "Dear procurement team",
      ],
    },
  ];

  const signoffs = [
    {
      target: "Best regards",
      alts: ["Warm regards", "Sincerely", "Kind regards", "Warmly"],
    },
    {
      target: "Best",
      alts: ["Best regards", "Kind regards", "Warmly", "Sincerely"],
    },
    {
      target: "Thank you",
      alts: [
        "Thanks so much",
        "Many thanks",
        "With appreciation",
        "Best regards",
      ],
    },
  ];

  const variations: string[] = [];
  for (let i = 0; i < 20; i++) {
    let current = text;
    greetings.forEach((g) => {
      if (current.includes(g.target)) {
        current = current.replace(g.target, g.alts[i % g.alts.length]);
      }
    });
    signoffs.forEach((s) => {
      if (current.includes(s.target)) {
        current = current.replace(s.target, s.alts[i % s.alts.length]);
      }
    });

    if (current === text || variations.includes(current)) {
      const suffixes = [
        " I appreciate your time.",
        " Looking forward to connecting.",
        " Hope we can catch up soon.",
        " Have a wonderful day.",
        " Enjoy the rest of your week.",
        " Let me know what you think.",
        " Thank you in advance for your consideration.",
        " Talk soon.",
        " Hope to speak details soon.",
        " Cheers.",
      ];
      
      const cleanCurrent = current.toLowerCase().replace(/[^a-z0-9]/g, "");
      const availableSuffixes = suffixes.filter((s) => {
        const cleanS = s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
        return !cleanCurrent.includes(cleanS);
      });

      const selectedSuffix =
        availableSuffixes.length > 0
          ? availableSuffixes[i % availableSuffixes.length]
          : " Best regards.";

      // Append to the last NON-EMPTY line so the suffix reads as a natural
      // closing at the end, instead of jamming onto the second-to-last line.
      const lines = current.split("\n");
      let li = lines.length - 1;
      while (li > 0 && lines[li].trim() === "") li--;
      lines[li] = lines[li] + selectedSuffix;
      current = lines.join("\n");
    }
    variations.push(current);
  }
  return variations;
};

interface PipelineCardProps {
  event: SavedEvent;
  selectedEventId: string | null;
  setSelectedEventId: (id: string | null) => void;
  onDragStart: (e: React.DragEvent, eventId: string) => void;
  onDragEnd: () => void;
  updateStatus: (
    eventId: string,
    newStatus: SavedEvent["status"],
  ) => Promise<void>;
  updateResponseOutcome: (
    eventId: string,
    outcome: ResponseOutcome | null,
  ) => Promise<void>;
  updateContactMethod: (
    eventId: string,
    contactMethod: string,
  ) => Promise<void>;
  updateNotes: (eventId: string, notes: string) => Promise<void>;
  updateEventDetails: (eventId: string, fields: Partial<SavedEvent>) => Promise<void>;
  updateActionNotes: (
    eventId: string,
    actionNotes: any[],
    latestNoteText?: string,
  ) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  stages: { id: string; label: string }[];
  projectName: string;
  userEmail: string;
  userDisplayName: string;
}

const PipelineCard: React.FC<PipelineCardProps> = ({
  event,
  selectedEventId,
  setSelectedEventId,
  onDragStart,
  onDragEnd,
  updateStatus,
  updateResponseOutcome,
  updateContactMethod,
  updateNotes,
  updateActionNotes,
  updateEventDetails,
  deleteEvent,
  stages,
  projectName,
  userEmail,
  userDisplayName,
}) => {
  const [canDrag, setCanDrag] = useState(true);
  const [featuredNoteId, setFeaturedNoteId] = useState<string | null>(null);
  const [newNoteValue, setNewNoteValue] = useState("");
  const isExpanded = selectedEventId === event.eventId;
  const cardRef = useRef<HTMLDivElement>(null);

  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editWebsite, setEditWebsite] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactRole, setNewContactRole] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactSocial, setNewContactSocial] = useState('');
  const [editingContactIdx, setEditingContactIdx] = useState<number | null>(null);
  const [editContactName, setEditContactName] = useState('');
  const [editContactRole, setEditContactRole] = useState('');
  const [editContactEmail, setEditContactEmail] = useState('');
  const [editContactPhone, setEditContactPhone] = useState('');
  const [editContactSocial, setEditContactSocial] = useState('');

  const startEditingContact = (idx: number) => {
    const c = (event.contacts || [])[idx];
    setEditContactName(c.name || '');
    setEditContactRole(c.role || '');
    setEditContactEmail(c.email || '');
    setEditContactPhone(c.phone || '');
    setEditContactSocial(c.social || '');
    setEditingContactIdx(idx);
  };

  const saveContactEdit = async () => {
    if (editingContactIdx === null) return;
    const updatedContacts = (event.contacts || []).map((c, i) =>
      i === editingContactIdx ? {
        ...c,
        name: editContactName.trim(),
        role: editContactRole.trim(),
        email: editContactEmail.trim(),
        phone: editContactPhone.trim(),
        social: editContactSocial.trim(),
        contactInfo: [editContactEmail.trim(), editContactPhone.trim(), editContactSocial.trim()].filter(Boolean).join(' | '),
      } : c
    );
    await updateEventDetails(event.eventId, { contacts: updatedContacts });
    setEditingContactIdx(null);
  };

  const startEditing = () => {
    setEditName(event.eventName);
    setEditDate(event.date || '');
    setEditLocation(event.location || '');
    setEditWebsite(event.website || '');
    setEditDescription(event.description || '');
    setIsEditingDetails(true);
  };

  const saveDetails = async () => {
    await updateEventDetails(event.eventId, {
      eventName: editName.trim() || event.eventName,
      date: editDate.trim(),
      location: editLocation.trim(),
      website: editWebsite.trim(),
      description: editDescription.trim(),
    });
    setIsEditingDetails(false);
  };

  const handleAddContact = async () => {
    if (!newContactName.trim()) return;
    const newContact = {
      name: newContactName.trim(),
      role: newContactRole.trim(),
      email: newContactEmail.trim(),
      phone: newContactPhone.trim(),
      social: newContactSocial.trim(),
      contactInfo: [newContactEmail.trim(), newContactPhone.trim(), newContactSocial.trim()].filter(Boolean).join(' | '),
    };
    const updatedContacts = [...(event.contacts || []), newContact];
    await updateEventDetails(event.eventId, { contacts: updatedContacts });
    setNewContactName(''); setNewContactRole(''); setNewContactEmail('');
    setNewContactPhone(''); setNewContactSocial('');
    setIsAddingContact(false);
  };

  const handleDeleteContact = async (idx: number) => {
    const contact = (event.contacts || [])[idx];
    if (!confirm(`Remove ${contact?.name || 'this contact'}?`)) return;
    const updatedContacts = (event.contacts || []).filter((_, i) => i !== idx);
    await updateEventDetails(event.eventId, { contacts: updatedContacts });
  };

  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [emailText, setEmailText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [copiedDraft, setCopiedDraft] = useState(false);
  const [copiedSubject, setCopiedSubject] = useState(false);
  const { user, profile } = useFirebase();
  const isAdmin = profile?.role === 'admin';
  // Templates are read-only here — reps select and send; management lives in the
  // admin-only Templates tab.
  const { templates } = useTemplates(user?.uid, isAdmin);
  // Per-session cache of generated copy variations + rotation index, keyed by
  // template id. Kept out of Firestore since it's ephemeral, per-browser state.
  const [variationsCache, setVariationsCache] = useState<Record<string, { variations: string[]; index: number }>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [isContactSelectorOpen, setIsContactSelectorOpen] = useState(false);
  const [selectedComposeContact, setSelectedComposeContact] = useState<any>(null);
  const [isMailClientSelectorOpen, setIsMailClientSelectorOpen] = useState(false);
  const [preferredMailClient, setPreferredMailClient] = useState<string | null>(() => localStorage.getItem("preferred_mail_client"));
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);

  const extractMonth = (dateStr: string): string => {
    if (!dateStr) return "upcoming month";
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    for (const m of months) {
      if (new RegExp(m, 'i').test(dateStr)) {
        return m;
      }
    }
    // Handle ranges like "2026-08-04 – 2026-08-06" by taking the first ISO date.
    const iso = dateStr.match(/\d{4}-\d{2}-\d{2}/);
    const candidate = iso ? iso[0] : dateStr;
    const d = new Date(candidate + (/^\d{4}-\d{2}-\d{2}$/.test(candidate) ? 'T00:00:00' : ''));
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'long' });
    }
    return dateStr;
  };

  const extractCity = (loc: string): string => {
    if (!loc) return "your area";
    const trimmed = loc.trim();
    if (!trimmed) return "your area";
    const parts = trimmed.split(',').map(p => p.trim());
    if (parts.length === 1) {
      return parts[0];
    }
    const countries = ['usa', 'us', 'united states', 'united kingdom', 'uk', 'canada', 'germany', 'france', 'spain', 'italy'];
    let lastIndex = parts.length - 1;
    if (countries.includes(parts[lastIndex].toLowerCase())) {
      lastIndex--;
    }
    if (lastIndex > 0) {
      return parts[lastIndex - 1];
    }
    return parts[0];
  };

  const applyReplacementsForContact = (tplText: string, contact: any) => {
    let text = tplText;
    const nameVal = event.eventName;
    // [Salesperson] inserts the rep's FIRST name only.
    const salespersonFirst = (userDisplayName || "Sales Representative").trim().split(/\s+/)[0];
    const contactNameVal = contact?.name || "Team";
    const locationVal = extractCity(event.location || "your area");
    const monthVal = extractMonth(event.date || "");

    // replace variables
    text = text.replace(/\[Event Name\]/gi, nameVal);
    text = text.replace(/\[Vendor Name\]/gi, nameVal);
    text = text.replace(/\[Event\]/gi, nameVal);
    text = text.replace(/\[Vendor\]/gi, nameVal);

    text = text.replace(/\[Salesperson\]/gi, salespersonFirst);
    text = text.replace(/\[Contact Name\]/gi, contactNameVal);
    text = text.replace(/\[Location\]/gi, locationVal);
    text = text.replace(/\[Month\]/gi, monthVal);
    text = text.replace(/\[Website\]/gi, "druid-productions.com");

    return text;
  };

  const applyTemplateForContact = async (templateId: string, contact: any) => {
    const found = templates.find((t) => t.id === templateId);
    if (!found) return;

    const cached = variationsCache[templateId];
    // Use cached variations (from a prior LLM fetch) or generate local ones now.
    const hadLlmVariations = !!cached?.variations && cached.variations.length >= 2;
    const currentVars = hadLlmVariations ? cached!.variations : generateLocalVariationsClient(found.text);
    const idx = cached?.index ?? 0;

    const rawText = currentVars[idx % currentVars.length];
    const resolved = applyReplacementsForContact(rawText, contact);
    setEmailText(resolved);
    setEmailSubject(applyReplacementsForContact(found.subject || "", contact));
    setSelectedComposeContact(contact);

    // Advance the rotation for next time.
    setVariationsCache((prev) => ({
      ...prev,
      [templateId]: { variations: currentVars, index: (idx + 1) % currentVars.length },
    }));

    // First time for this template: fetch richer LLM variations in the background.
    if (!hadLlmVariations) {
      try {
        const res = await fetch("/api/email-variations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: found.text }),
        });
        const data = await res.json();
        if (data.variations && Array.isArray(data.variations) && data.variations.length >= 2) {
          setVariationsCache((prev) => ({
            ...prev,
            [templateId]: { variations: data.variations, index: prev[templateId]?.index ?? 0 },
          }));
        }
      } catch (e) {
        console.error("Failed to fetch variations in background:", e);
      }
    }
  };

  const handleSelectTemplate = async (id: string) => {
    setSelectedTemplateId(id);
    if (!id) {
      setEmailText("");
      setEmailSubject("");
      setSelectedComposeContact(null);
      return;
    }
    const contactsList = event.contacts || [];
    if (contactsList.length > 0) {
      setPendingTemplateId(id);
      setIsContactSelectorOpen(true);
    } else {
      applyTemplateForContact(id, null);
    }
  };

  const handleCopyText = async () => {
    if (!emailText) return;
    const flash = () => { setCopiedDraft(true); setTimeout(() => setCopiedDraft(false), 2000); };

    // Build an HTML version so URLs (e.g. druid-productions.com) paste into Gmail
    // as real clickable links, while keeping a plain-text fallback.
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const linkify = (s: string) =>
      s.replace(/\b(https?:\/\/[^\s<]+|www\.[^\s<]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|us|tech)(?:\/[^\s<]*)?)/gi, (url) => {
        const trail = (url.match(/[.,;:!?)]+$/) || [""])[0];
        const clean = trail ? url.slice(0, -trail.length) : url;
        const href = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
        return `<a href="${href}">${clean}</a>${trail}`;
      });
    const html = linkify(esc(emailText)).replace(/\n/g, "<br>");

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([emailText], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      flash();
    } catch {
      // Older browsers / no rich-clipboard support — fall back to plain text.
      navigator.clipboard.writeText(emailText).then(flash).catch(() => {});
    }
  };

  const launchEmailClient = (clientKey: string) => {
    const toEmail = selectedComposeContact?.email || "";
    const subject = emailSubject || `Outreach - ${event.eventName}`;
    
    // Remember preference if checkbox checked
    const checkbox = document.getElementById(`remember_email_choice_${event.eventId}`) as HTMLInputElement;
    if (checkbox?.checked) {
      localStorage.setItem("preferred_mail_client", clientKey);
      setPreferredMailClient(clientKey);
    }
    
    let url = "";
    if (clientKey === "gmail") {
      url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(toEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailText)}`;
    } else if (clientKey === "outlook") {
      url = `https://outlook.live.com/owa/?path=/mail/action/compose&to=${encodeURIComponent(toEmail)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailText)}`;
    } else if (clientKey === "yahoo") {
      url = `https://compose.mail.yahoo.com/?to=${encodeURIComponent(toEmail)}&subj=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailText)}`;
    } else {
      url = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailText)}`;
    }

    if (clientKey === "default") {
      window.location.href = url;
    } else {
      window.open(url, "_blank");
    }
    setIsMailClientSelectorOpen(false);
  };

  const handleLaunchEmailProgram = () => {
    if (preferredMailClient) {
      launchEmailClient(preferredMailClient);
    } else {
      setIsMailClientSelectorOpen(true);
    }
  };

  const handleCancelContactSelect = () => {
    setIsContactSelectorOpen(false);
    if (pendingTemplateId) {
      applyTemplateForContact(pendingTemplateId, null);
    }
    setPendingTemplateId(null);
  };

  const notesList = event.actionNotes || [];
  const featuredNote =
    notesList.find((n) => n.id === featuredNoteId) || notesList[0];

  // Click outside detector to minimize card and restore defaults
  useEffect(() => {
    if (!isExpanded) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setSelectedEventId(null);
      }
    };

    // Delay attachment so we don't immediately intercept the opening click
    const timer = setTimeout(() => {
      document.addEventListener("click", handleOutsideClick);
    }, 120);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [isExpanded, setSelectedEventId]);

  const handleSaveCardNote = async () => {
    if (!newNoteValue.trim()) return;

    const newNote = {
      id: Math.random().toString(36).substring(2, 11),
      text: newNoteValue.trim(),
      createdAt: new Date().toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    };

    const updatedNotes = [newNote, ...notesList];
    await updateActionNotes(event.eventId, updatedNotes, newNoteValue.trim());
    setNewNoteValue("");
    setFeaturedNoteId(newNote.id);
  };

  const handleDeleteCardNote = async (noteId: string) => {
    const updatedNotes = notesList.filter((note) => note.id !== noteId);
    if (featuredNoteId === noteId) {
      setFeaturedNoteId(null);
    }
    await updateActionNotes(
      event.eventId,
      updatedNotes,
      updatedNotes[0]?.text || "",
    );
  };

  const downloadSingleCardCSV = () => {
    const escapeCSV = (val: string) => {
      if (!val) return '""';
      return `"${val.replace(/"/g, '""').replace(/\n/g, " ")}"`;
    };

    const headers = [
      "Salesperson",
      "App Project Name",
      "Exported Timestamp",
      "Event/Vendor Name",
      "Pipeline Status",
      "Type",
      "Date",
      "Product/Services",
      "Location / Corporate HQ",
      "Contact Method",
      "General Notes",
    ];

    const maxContacts = Math.max(3, event.contacts?.length || 0);
    const maxActions = Math.max(3, (event.actionNotes || []).length);

    for (let i = 1; i <= maxContacts; i++) {
      headers.push(
        `Contact ${i} Name`,
        `Contact ${i} Role`,
        `Contact ${i} Email`,
        `Contact ${i} Phone`,
        `Contact ${i} Social`,
      );
    }

    for (let j = 1; j <= maxActions; j++) {
      headers.push(`Action/Note ${j} Date`, `Action/Note ${j} Text`);
    }

    const typeLabel = event.searchType === "vendor" ? "Vendor" : "Event";
    const isVendor = event.searchType === "vendor";
    const locationLabel = isVendor ? `HQ: ${event.location}` : event.location;
    const generalNotes = event.notes || "";

    const rowValues = [
      escapeCSV(`${userDisplayName} <${userEmail}>`),
      escapeCSV(projectName || "Active Project"),
      escapeCSV(new Date().toUTCString()),
      escapeCSV(event.eventName),
      escapeCSV(event.status),
      escapeCSV(typeLabel),
      escapeCSV(isVendor ? "" : event.date),
      escapeCSV(isVendor ? event.date : ""),
      escapeCSV(locationLabel),
      escapeCSV(event.contactMethod || "None"),
      escapeCSV(generalNotes),
    ];

    for (let i = 0; i < maxContacts; i++) {
      const c = event.contacts && event.contacts[i] ? event.contacts[i] : null;
      rowValues.push(
        escapeCSV(c?.name || ""),
        escapeCSV(c?.role || ""),
        escapeCSV(c?.email || ""),
        escapeCSV(c?.phone || ""),
        escapeCSV(c?.social || ""),
      );
    }

    for (let j = 0; j < maxActions; j++) {
      const n =
        event.actionNotes && event.actionNotes[j] ? event.actionNotes[j] : null;
      rowValues.push(escapeCSV(n?.createdAt || ""), escapeCSV(n?.text || ""));
    }

    const csvContent = [headers.join(","), rowValues.join(",")].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    const safeEventName = event.eventName.trim().replace(/[^a-zA-Z0-9]/g, "_");

    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `Card_Share_${safeEventName}_${new Date().toISOString().split("T")[0]}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getContainerClasses = () => {
    const outcome = event.status === "Responded" ? event.responseOutcome : null;
    if (event.status === "Initial") {
      return isExpanded
        ? "border-white/70 bg-zinc-900/40 ring-2 ring-white/30 shadow-white/10"
        : "border-white/45 bg-[#141416] hover:border-white/65 hover:bg-[#1f1f22]";
    } else if (event.status === "Contacted") {
      return isExpanded
        ? "border-orange-500/75 bg-[#261203] ring-2 ring-orange-500/30 shadow-orange-950/70"
        : "border-orange-500/50 bg-[#170a01] hover:border-orange-500/70 hover:bg-[#251002]";
    } else if (outcome === "Interested") {
      return isExpanded
        ? "border-green-500/75 bg-[#031a06] ring-2 ring-green-500/30 shadow-green-950/70"
        : "border-green-500/50 bg-[#021204] hover:border-green-500/70 hover:bg-[#032508]";
    } else if (outcome === "Maybe") {
      return isExpanded
        ? "border-amber-500/75 bg-[#1a1103] ring-2 ring-amber-500/30 shadow-amber-950/70"
        : "border-amber-500/50 bg-[#120c02] hover:border-amber-500/70 hover:bg-[#201503]";
    } else if (outcome === "Not Interested") {
      return isExpanded
        ? "border-red-500/75 bg-[#1a0303] ring-2 ring-red-500/30 shadow-red-950/70"
        : "border-red-500/50 bg-[#120202] hover:border-red-500/70 hover:bg-[#200303]";
    } else {
      return isExpanded
        ? "border-teal-500/75 bg-[#031d1a] ring-2 ring-teal-500/30 shadow-teal-950/70"
        : "border-teal-500/50 bg-[#021412] hover:border-teal-500/70 hover:bg-[#032521]";
    }
  };

  const getGlowStyle = () => {
    const outcome = event.status === "Responded" ? event.responseOutcome : null;
    if (event.status === "Initial")
      return {
        background:
          "radial-gradient(circle, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.20) 45%, rgba(0,0,0,0) 70%)",
      };
    if (event.status === "Contacted")
      return {
        background:
          "radial-gradient(circle, rgba(249,115,22,0.75) 0%, rgba(249,115,22,0.20) 45%, rgba(0,0,0,0) 70%)",
      };
    if (outcome === "Interested")
      return {
        background:
          "radial-gradient(circle, rgba(34,197,94,0.75) 0%, rgba(34,197,94,0.20) 45%, rgba(0,0,0,0) 70%)",
      };
    if (outcome === "Maybe")
      return {
        background:
          "radial-gradient(circle, rgba(245,158,11,0.75) 0%, rgba(245,158,11,0.20) 45%, rgba(0,0,0,0) 70%)",
      };
    if (outcome === "Not Interested")
      return {
        background:
          "radial-gradient(circle, rgba(239,68,68,0.75) 0%, rgba(239,68,68,0.20) 45%, rgba(0,0,0,0) 70%)",
      };
    return {
      background:
        "radial-gradient(circle, rgba(20,184,166,0.75) 0%, rgba(20,184,166,0.20) 45%, rgba(0,0,0,0) 70%)",
    };
  };

  return (
    <motion.div
      ref={cardRef}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className={cn(
        "w-full border-2 rounded-xl transition-all duration-500 shadow-md select-text p-3 flex flex-col relative overflow-hidden",
        getContainerClasses(),
      )}
    >
      {/* Horizontal row trigger bar */}
      <div
        className="grid grid-cols-12 gap-3 items-center w-full cursor-pointer relative z-10"
        onClick={() => setSelectedEventId(isExpanded ? null : event.eventId)}
      >
        {/* Name Column */}
        <div className="col-span-12 md:col-span-3 min-w-0 flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-primary shrink-0 transition-transform duration-250 rotate-180" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-500 shrink-0 transition-transform duration-250" />
          )}

          <div className="min-w-0 pr-2">
            <h5 className="font-semibold text-xs text-white hover:text-primary transition-colors truncate">
              {event.eventName}
            </h5>
            {event.isSandbox && (
              <span className="inline-flex items-center gap-1 mt-0.5 text-[7px] text-amber-405 font-bold uppercase tracking-wider bg-amber-500/10 border border-amber-500/25 px-1 py-0.2 rounded">
                Sandbox
              </span>
            )}
          </div>
        </div>

        {/* Type Column */}
        <div className="col-span-3 md:col-span-1 flex items-center">
          {event.searchType === "vendor" ? (
            <span className="px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 whitespace-nowrap">
              VENDOR
            </span>
          ) : (
            <span className="px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide bg-blue-500/10 border border-blue-500/20 text-blue-400 whitespace-nowrap">
              EVENT
            </span>
          )}
        </div>

        {/* Date Column */}
        <div className="col-span-9 md:col-span-2 min-w-0 flex items-center gap-1.5 text-[9.5px] text-slate-400 truncate">
          {event.searchType === "vendor" ? (
            <Briefcase className="h-3 w-3 text-primary/60 shrink-0" />
          ) : (
            <Calendar className="h-3 w-3 text-primary/60 shrink-0" />
          )}
          <span className="truncate">{formatDate(event.date) || event.date || "n/a"}</span>
        </div>

        {/* Location Column */}
        <div className="col-span-12 md:col-span-2 min-w-0 flex items-center gap-1.5 text-[9.5px] text-slate-400 truncate">
          <MapPin className="h-3 w-3 text-primary/60 shrink-0" />
          <span className="truncate">
            {event.searchType === "vendor" && event.location && !event.location.startsWith("HQ:")
              ? `HQ: ${event.location}`
              : event.location || "n/a"}
          </span>
        </div>

        {/* Status Dropdown Column */}
        <div
          className="col-span-12 md:col-span-3 flex items-center justify-start md:justify-end gap-2 relative"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Radial glow background burst centered on the dropdown status menu */}
          <div
            className="absolute pointer-events-none rounded-full blur-[45px] opacity-65 z-0 transition-all duration-500 -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2 w-[280px] h-[280px] md:w-[320px] md:h-[320px]"
            style={getGlowStyle()}
          />
          <div className="relative shrink-0 z-10">
            <select
              value={event.status}
              onChange={(e) => {
                updateStatus(
                  event.eventId,
                  e.target.value as SavedEvent["status"],
                );
              }}
              className="bg-zinc-950/80 border border-white/20 hover:border-white/30 rounded pl-2 pr-6 py-1 text-[10px] font-bold text-slate-100 focus:outline-none focus:border-white/40 appearance-none transition-all cursor-pointer"
            >
              <option value="Initial" className="bg-[#030712]">
                Not Started
              </option>
              <option value="Contacted" className="bg-[#030712]">
                Contacted
              </option>
              <option value="Responded" className="bg-[#030712]">
                Responded
              </option>
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
          </div>
          {event.status === "Responded" && (
            <div className="flex items-center gap-1 z-10 flex-wrap">
              {(["Interested", "Maybe", "Not Interested"] as const).map(
                (outcome) => (
                  <button
                    key={outcome}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateResponseOutcome(
                        event.eventId,
                        event.responseOutcome === outcome ? null : outcome,
                      );
                    }}
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[8px] font-bold border transition-all cursor-pointer whitespace-nowrap",
                      event.responseOutcome === outcome
                        ? outcome === "Interested"
                          ? "bg-green-500/25 border-green-500/50 text-green-300"
                          : outcome === "Maybe"
                            ? "bg-amber-500/25 border-amber-500/50 text-amber-300"
                            : "bg-red-500/25 border-red-500/50 text-red-300"
                        : "bg-white/5 border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300",
                    )}
                  >
                    {outcome}
                  </button>
                ),
              )}
            </div>
          )}
        </div>

        {/* Actions Column */}
        <div
          className="col-span-12 md:col-span-1 flex items-center justify-end gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => downloadSingleCardCSV()}
            className="p-1 px-1.5 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded border border-white/5 hover:border-white/10 transition-all cursor-pointer flex items-center justify-center"
            title="Share Card CSV"
          >
            <Share2 className="h-3 w-3" />
          </button>

          <button
            type="button"
            onClick={() => deleteEvent((event as any).docId || event.eventId)}
            className="p-1 px-1.5 bg-white/10 hover:bg-white/20 text-white rounded border border-white/20 hover:border-white/40 transition-all cursor-pointer flex items-center justify-center shadow-sm"
            title="Delete Event"
          >
            <Trash2 className="h-3.5 w-3.5 text-white" />
          </button>
        </div>
      </div>

      {/* Expanded view for viewing ALL contact information details and notes */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-3 pt-3 border-t border-white/10 space-y-3 relative z-10"
          onClick={(e) => e.stopPropagation()}
        >
          {event.status === "Contacted" && (
            <div className="flex items-center gap-2 bg-black/40 p-1.5 rounded border border-white/5 mb-1.5 self-start w-fit">
              <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 pl-1">
                Outreach Method:
              </span>
              <select
                value={event.contactMethod || "Email"}
                onChange={(e) =>
                  updateContactMethod(event.eventId, e.target.value)
                }
                className="bg-zinc-900 border border-white/15 rounded px-2 py-0.5 text-[10px] text-primary focus:outline-none focus:border-primary/40 cursor-pointer"
              >
                <option value="Email" className="bg-[#030712]">
                  Email
                </option>
                <option value="Phone Call" className="bg-[#030712]">
                  Phone Call
                </option>
                <option value="LinkedIn" className="bg-[#030712]">
                  LinkedIn
                </option>
                <option value="In Person" className="bg-[#030712]">
                  In Person
                </option>
                <option value="Other" className="bg-[#030712]">
                  Other
                </option>
              </select>
            </div>
          )}

          {/* Grid Layout taking advantage of 3-column wide layout */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Columns 1 & 2: Email Composer or Details Overview */}
            {isComposerOpen ? (
              <div
                key="composer-box"
                className="col-span-1 md:col-span-2 bg-[#090d16]/85 p-4 rounded-xl border border-primary/25 flex flex-col justify-between shadow-2xl relative select-text mb-2 min-h-[320px] h-full space-y-3"
              >
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-2 shrink-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Mail className="h-4 w-4 text-primary animate-pulse" />
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider font-mono">
                      AI Email Composer
                    </span>
                    {selectedTemplateId && (
                      <span className="text-[8px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20 font-mono animate-pulse uppercase tracking-wider font-bold">
                        Rotator active - copy #
                        {(variationsCache[selectedTemplateId]?.index || 0) + 1}
                        /20
                      </span>
                    )}
                    <span className="text-[9.5px] text-orange-400 font-bold border border-orange-500/20 bg-orange-500/10 px-2 py-0.5 rounded-lg animate-pulse ml-2">
                      ⚠️ Please check 'Location' and 'Month' in message for accuracy before sending!
                    </span>
                  </div>
                </div>

                {/* Combined Sub-header Row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs text-slate-350 shrink-0 border-b border-white/5 pb-2">
                  {/* To: Selector */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono uppercase tracking-wider font-bold text-slate-500">To:</span>
                    <div className="relative min-w-[170px] max-w-[200px]">
                      <select
                        value={selectedComposeContact ? (event.contacts || []).indexOf(selectedComposeContact) : -1}
                        onChange={(e) => {
                          const idx = parseInt(e.target.value);
                          const contact = idx >= 0 ? (event.contacts || [])[idx] : null;
                          setSelectedComposeContact(contact);
                          // If there is an active template, re-apply replacements for this contact
                          if (selectedTemplateId) {
                            const found = templates.find(t => t.id === selectedTemplateId);
                            if (found) {
                              const cached = variationsCache[selectedTemplateId];
                              const vars = (cached?.variations && cached.variations.length >= 2)
                                ? cached.variations
                                : generateLocalVariationsClient(found.text);
                              const idx = cached?.index ?? 0;
                              const rawText = vars[idx % vars.length];
                              setEmailText(applyReplacementsForContact(rawText, contact));
                              setEmailSubject(applyReplacementsForContact(found.subject || "", contact));
                            }
                          }
                        }}
                        className="bg-black/60 border border-white/10 hover:border-white/20 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none focus:border-primary/40 cursor-pointer w-full appearance-none pr-6 font-sans font-medium"
                      >
                        <option value={-1}>-- Select Recipient --</option>
                        {(event.contacts || []).map((contact, idx) => (
                          <option key={idx} value={idx}>
                            {contact.name} {contact.role ? `(${contact.role})` : ""}
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-555 text-[8px]">▼</div>
                    </div>
                  </div>

                  {/* Using Indicator */}
                  {selectedComposeContact && (
                    <span className="text-[9.5px] text-slate-450 truncate">
                      Using: <span className="text-white font-semibold font-mono">{selectedComposeContact.name}</span>
                    </span>
                  )}

                  {/* Divider line */}
                  <div className="hidden sm:block h-3.5 w-px bg-white/10" />

                  {/* Template Dropdown */}
                  <div className="flex items-center gap-1.5 relative">
                    <span className="text-[9px] font-mono uppercase tracking-wider font-bold text-slate-500">Template:</span>
                    <button
                      type="button"
                      onClick={() => setIsTemplateMenuOpen(!isTemplateMenuOpen)}
                      className="bg-black/60 border border-white/10 hover:border-white/20 rounded px-2.5 py-0.5 text-[10px] text-slate-200 focus:outline-none focus:border-primary/40 flex items-center justify-between gap-1.5 font-sans font-medium min-w-[130px] max-w-[170px] cursor-pointer"
                    >
                      <span className="truncate">
                        {selectedTemplateId
                          ? templates.find((t) => t.id === selectedTemplateId)?.name || "Custom Draft"
                          : "-- Choose Template --"}
                      </span>
                      <ChevronDown className="h-2.5 w-2.5 text-slate-450 shrink-0" />
                    </button>

                    {isTemplateMenuOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setIsTemplateMenuOpen(false)}
                        />
                        <div className="absolute top-full left-0 mt-1 w-[200px] bg-[#0c101a] border border-white/10 rounded-lg shadow-2xl py-1 z-50 max-h-[180px] overflow-y-auto custom-scrollbar">
                          {templates.length === 0 ? (
                            <div className="px-3 py-2 text-[8px] text-slate-450 italic">
                              No templates available.
                            </div>
                          ) : (
                            templates.map((tpl) => (
                              <div
                                key={tpl.id}
                                className="flex items-center justify-between px-2.5 py-1.5 hover:bg-white/[0.04] text-[9.5px] text-slate-200 transition-colors cursor-pointer group"
                                onClick={() => {
                                  handleSelectTemplate(tpl.id);
                                  setIsTemplateMenuOpen(false);
                                }}
                              >
                                <span className="truncate pr-2 font-sans font-medium flex items-center gap-1.5">
                                  {tpl.name}
                                  {tpl.scope === 'shared' && (
                                    <span className="text-[7px] uppercase tracking-wider font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded px-1 py-px shrink-0">Shared</span>
                                  )}
                                  {tpl.scope === 'default' && (
                                    <span className="text-[7px] uppercase tracking-wider font-bold text-slate-400 bg-white/5 border border-white/10 rounded px-1 py-px shrink-0">Default</span>
                                  )}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    )}
                  </div>

                </div>

                {/* Subject line (read-only, filled from the template) */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[9px] font-mono uppercase tracking-wider font-bold text-slate-500 shrink-0">Subject:</span>
                  <input
                    value={emailSubject}
                    readOnly
                    placeholder="Filled from the selected template"
                    className="flex-1 bg-black/50 border border-white/5 rounded px-2.5 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none select-text cursor-default"
                  />
                  <button
                    type="button"
                    onClick={() => { if (emailSubject) { navigator.clipboard.writeText(emailSubject); setCopiedSubject(true); setTimeout(() => setCopiedSubject(false), 1500); } }}
                    className="shrink-0 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] text-slate-300 transition-colors"
                  >
                    {copiedSubject ? "✓" : "Copy"}
                  </button>
                </div>

                {/* Body Composition space - utilizes the full remaining height of the container */}
                <div className="relative select-text flex-grow flex flex-col min-h-[180px] md:min-h-[220px]">
                  <textarea
                    value={emailText}
                    readOnly
                    placeholder="Select a template and a recipient above — it will auto-fill here, ready to copy and send. Templates are managed by admins in the Templates tab."
                    className="w-full flex-grow bg-black/50 border border-white/5 rounded-lg p-3 text-xs text-slate-200 placeholder-slate-600 focus:outline-none h-full custom-scrollbar font-sans select-text leading-relaxed resize-none scrollbar-thin cursor-default"
                  />
                </div>

                {/* Footer with actions: Copy Text, New Email client */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-white/5 shrink-0">
                  <div className="text-[8px] text-slate-500 font-mono">
                    Placeholders supported:{" "}
                    <span className="text-primary font-bold">
                      [Event Name], [Contact Name], [Month], [Location], [Salesperson], [Website]
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Copy Text */}
                    <button
                      type="button"
                      onClick={handleCopyText}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-350 hover:text-white border border-white/10 rounded-lg text-[9px] font-bold cursor-pointer transition-all"
                    >
                      <Copy className="h-3 w-3 text-slate-450" />
                      <span>{copiedDraft ? "Copied!" : "Copy Text"}</span>
                    </button>

                    {/* Open in Default Email Client */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={handleLaunchEmailProgram}
                        className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-primary hover:bg-secondary text-slate-900 font-bold rounded-lg text-[9px] cursor-pointer transition-all shadow-md"
                      >
                        <Zap className="h-3.5 w-3.5 text-slate-900 animate-pulse" />
                        <span>New Email {preferredMailClient ? `(${preferredMailClient === 'gmail' ? 'Gmail' : preferredMailClient === 'outlook' ? 'Outlook' : preferredMailClient === 'yahoo' ? 'Yahoo' : 'Default'})` : ""}</span>
                      </button>
                      {preferredMailClient && (
                        <button
                          type="button"
                          onClick={() => {
                            setPreferredMailClient(null);
                            localStorage.removeItem("preferred_mail_client");
                          }}
                          className="px-1.5 py-1.5 text-[9.5px] text-slate-455 hover:text-white hover:bg-white/5 border border-transparent rounded-lg transition-all cursor-pointer font-mono"
                          title="Change preferred email client"
                        >
                          Change
                        </button>
                      )}
                    </div>

                    {/* Mark as Sent button */}
                    <button
                      type="button"
                      onClick={async () => {
                        setIsComposerOpen(false);
                        await updateStatus(event.eventId, "Contacted");
                      }}
                      className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-red-650 hover:bg-red-500 text-white font-bold rounded-lg text-[9px] cursor-pointer transition-all shadow-md shrink-0"
                      title="Mark email as sent and change status to Contacted"
                    >
                      <span>Mark as Sent</span>
                    </button>

                    {/* Button to Close Composer */}
                    <button
                      type="button"
                      onClick={() => setIsComposerOpen(false)}
                      className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-slate-450 hover:text-white rounded-lg text-[9px] cursor-pointer border border-white/10"
                    >
                      Close Composer
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Column 1: Record Overview / Edit */}
                <div className="space-y-3 bg-black/35 p-3.5 rounded-xl border border-white/5 flex flex-col h-full min-h-[320px]">
                  <div className="flex items-center justify-between pb-1.5 border-b border-white/5 shrink-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {event.logoUrl ? (
                        <img src={event.logoUrl} alt={event.eventName} referrerPolicy="no-referrer" className="w-8 h-8 rounded object-contain bg-white/5 p-0.5 shrink-0" />
                      ) : (
                        <div className="w-8 h-8 bg-primary/10 border border-primary/20 rounded-lg flex items-center justify-center font-bold text-primary font-mono text-[11px] shrink-0">
                          {(isEditingDetails ? editName : event.eventName).trim().charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <span className="text-[7.5px] uppercase tracking-widest text-primary font-bold font-mono block">Overview Profile</span>
                        {!isEditingDetails && <h4 className="text-[11.5px] font-bold text-white leading-tight truncate">{event.eventName}</h4>}
                      </div>
                    </div>
                    {!isEditingDetails ? (
                      <button type="button" onClick={startEditing} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer shrink-0" title="Edit lead details">
                        <Edit3 className="h-3 w-3" />
                      </button>
                    ) : (
                      <div className="flex gap-1.5 shrink-0">
                        <button type="button" onClick={saveDetails} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-[9px] font-bold cursor-pointer transition-all">
                          <Check className="h-3 w-3" /> Save
                        </button>
                        <button type="button" onClick={() => setIsEditingDetails(false)} className="p-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white cursor-pointer transition-all">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditingDetails ? (
                    <div className="flex flex-col gap-2 flex-1 overflow-y-auto custom-scrollbar">
                      {[
                        { label: 'Name', value: editName, set: setEditName, placeholder: 'Event or company name' },
                        { label: 'Website', value: editWebsite, set: setEditWebsite, placeholder: 'https://...' },
                        { label: event.searchType === 'vendor' ? 'Services / Focus' : 'Date', value: editDate, set: setEditDate, placeholder: event.searchType === 'vendor' ? 'e.g. Lead Retrieval, App Dev' : 'e.g. Aug 1–3, 2026' },
                        { label: event.searchType === 'vendor' ? 'HQ Location' : 'Location', value: editLocation, set: setEditLocation, placeholder: 'City, State' },
                      ].map(({ label, value, set, placeholder }) => (
                        <div key={label} className="space-y-0.5">
                          <label className="text-[8.5px] uppercase tracking-wider text-slate-500 font-bold font-mono">{label}</label>
                          <input
                            type="text"
                            value={value}
                            onChange={e => set(e.target.value)}
                            placeholder={placeholder}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-white focus:outline-none focus:border-primary/50 font-sans"
                          />
                        </div>
                      ))}
                      <div className="space-y-0.5 flex-1 flex flex-col">
                        <label className="text-[8.5px] uppercase tracking-wider text-slate-500 font-bold font-mono">Description</label>
                        <textarea
                          value={editDescription}
                          onChange={e => setEditDescription(e.target.value)}
                          placeholder="Bio / description..."
                          className="flex-1 min-h-[100px] bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-white focus:outline-none focus:border-primary/50 resize-none font-sans custom-scrollbar"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col gap-2.5 min-h-0">
                      {event.website && (
                        <div className="text-[9.5px] text-slate-400 truncate flex items-center gap-1.5 shrink-0">
                          <LinkIcon className="h-3 w-3 text-slate-600 shrink-0" />
                          <a href={event.website.startsWith("http") ? event.website : `https://${event.website}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                            {event.website}
                          </a>
                        </div>
                      )}
                      <div className="flex-grow flex flex-col min-h-0 pt-0.5">
                        <span className="font-semibold text-slate-400 block mb-1.5 text-[8.5px] uppercase tracking-wider font-mono shrink-0">Description:</span>
                        <div className="text-[10px] text-slate-300 leading-relaxed bg-black/20 p-3 rounded-lg border border-white/5 overflow-y-auto custom-scrollbar flex-grow min-h-[160px] max-h-[320px]">
                          {event.description || "No description yet. Click the edit button to add one."}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Column 2: Status Log Context - Now populating with all user notes */}
                <div className="space-y-3 bg-black/35 p-3.5 rounded-xl border border-white/5 flex flex-col justify-between select-text min-h-[320px]">
                  <div className="space-y-2.5 select-text flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between pb-1.5 border-b border-white/5 shrink-0">
                      <div className="flex items-center gap-1.5 select-text">
                        <MessageSquare className="h-3.5 w-3.5 text-primary shrink-0" />
                        <label className="text-[8px] uppercase font-bold text-slate-300 tracking-widest font-mono">
                          Active General Notes
                        </label>
                      </div>
                      <span className="text-[7.5px] uppercase tracking-wider text-slate-500 font-bold font-mono">
                        {notesList.length} Entries
                      </span>
                    </div>

                    {/* Scrollable Timeline list of user notes separated by timestamp subtitles */}
                    <div className="flex-1 overflow-y-auto min-h-[140px] max-h-[260px] custom-scrollbar space-y-3 pr-1 py-1 select-text scrollbar-thin">
                      {notesList.length === 0 ? (
                        <div className="text-[9.5px] text-slate-500 italic py-4 text-center">
                          No logging timeline or notes registered yet. Type
                          updates below.
                        </div>
                      ) : (
                        notesList.map((note) => (
                          <div
                            key={note.id}
                            className="p-2.5 rounded bg-white/[0.015] border border-white/5 relative group/note select-text transition-all hover:bg-white/[0.03]"
                          >
                            <div className="flex justify-between items-center gap-2 mb-1 border-b border-white/[0.03] pb-1 select-text">
                              <span className="text-[7.5px] text-primary/80 font-mono tracking-tight select-text font-semibold">
                                {note.createdAt}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDeleteCardNote(note.id)}
                                className="opacity-0 group-hover/note:opacity-100 p-0.5 hover:bg-red-500/10 text-slate-500 hover:text-red-500 rounded transition-all cursor-pointer"
                                title="Delete log entry"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                            <div className="text-[10px] text-slate-250 select-text break-words leading-relaxed whitespace-pre-wrap font-sans">
                              {note.text}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Note Creator Input Field inside Center Column */}
                  <div className="space-y-2 pt-2 border-t border-white/5 select-text shrink-0">
                    <textarea
                      placeholder="Type a new update, action log, or note here..."
                      value={newNoteValue}
                      onChange={(e) => setNewNoteValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-black/40 border border-white/5 rounded-lg p-2 text-[9.5px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-primary/40 min-h-[42px] max-h-[80px] resize-y custom-scrollbar font-sans select-text scrollbar-thin"
                    />
                    {newNoteValue.trim() && (
                      <div className="flex justify-end select-text">
                        <button
                          type="button"
                          onClick={handleSaveCardNote}
                          className="px-2.5 py-1 bg-primary text-[8.5px] hover:bg-secondary text-slate-900 rounded font-bold transition-all cursor-pointer shadow-md"
                        >
                          Save Entry
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Column 3: Stacked Contacts AND Action logs - now take full height with enlarged Compose Email at top */}
            <div className="space-y-3.5 col-span-1 flex flex-col h-full select-text">
              {/* Larger Compose Email Button at top of Column 3 */}
              <button
                type="button"
                onClick={() => {
                  const nextVal = !isComposerOpen;
                  setIsComposerOpen(nextVal);
                  if (nextVal) {
                    const defaultTemplateId = "druid_intro";
                    setSelectedTemplateId(defaultTemplateId);

                    const firstContact =
                      event.contacts && event.contacts.length > 0
                        ? event.contacts[0]
                        : null;
                    setSelectedComposeContact(firstContact);
                    applyTemplateForContact(defaultTemplateId, firstContact);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-[10px] uppercase font-mono tracking-widest bg-gradient-to-b from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 text-white font-extrabold rounded-xl transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shrink-0 focus:outline-none border-2 border-white/90 hover:border-white shadow-[0_12px_28px_rgba(20,184,166,0.45),_0_4px_8px_rgba(0,0,0,0.5)]"
              >
                <Mail className="h-4 w-4 text-white shrink-0 animate-pulse" />
                <span>
                  {isComposerOpen ? "Close Email Composer" : "Compose Email"}
                </span>
              </button>

              {/* Contacts Info Box */}
              <div className="bg-[#040812]/50 p-3.5 rounded-xl border border-white/5 shadow-inner flex-grow flex flex-col h-full">
                <div className="flex items-center justify-between pb-1.5 border-b border-white/5 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3 w-3 text-primary" />
                    <label className="text-[8px] uppercase font-bold text-slate-300 tracking-widest font-mono">
                      Contacts ({(event.contacts || []).length})
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAddingContact(!isAddingContact)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-[8px] font-bold cursor-pointer transition-all"
                  >
                    <Plus className="h-2.5 w-2.5" /> Add
                  </button>
                </div>

                {isAddingContact && (
                  <div className="mt-2 mb-1 p-2.5 rounded-lg bg-white/[0.03] border border-primary/20 space-y-1.5 shrink-0">
                    <p className="text-[8px] uppercase tracking-wider text-primary font-bold font-mono">New Contact</p>
                    {[
                      { placeholder: 'Name *', value: newContactName, set: setNewContactName },
                      { placeholder: 'Role / Title', value: newContactRole, set: setNewContactRole },
                      { placeholder: 'Email', value: newContactEmail, set: setNewContactEmail },
                      { placeholder: 'Phone', value: newContactPhone, set: setNewContactPhone },
                      { placeholder: 'LinkedIn URL', value: newContactSocial, set: setNewContactSocial },
                    ].map(({ placeholder, value, set }) => (
                      <input
                        key={placeholder}
                        type="text"
                        placeholder={placeholder}
                        value={value}
                        onChange={e => set(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[9.5px] text-white placeholder-slate-600 focus:outline-none focus:border-primary/40 font-sans"
                      />
                    ))}
                    <div className="flex gap-1.5 pt-0.5">
                      <button type="button" onClick={handleAddContact} disabled={!newContactName.trim()} className="flex-1 py-1 bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-[8.5px] font-bold rounded cursor-pointer transition-all disabled:opacity-40">Save Contact</button>
                      <button type="button" onClick={() => setIsAddingContact(false)} className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 text-[8.5px] rounded cursor-pointer transition-all">Cancel</button>
                    </div>
                  </div>
                )}

                {(event.contacts || []).length === 0 && !isAddingContact ? (
                  <div className="text-[9px] text-slate-500 italic py-4 text-center font-mono flex-1">No contacts yet.</div>
                ) : (
                  <div className="space-y-2 overflow-y-auto custom-scrollbar pr-0.5 flex-1 mt-2 max-h-[380px]">
                    {(event.contacts || []).map((contact, cIdx) => (
                      <div key={cIdx} className="p-2.5 rounded bg-white/[0.015] border border-white/5 text-[10px] transition-all group/contact relative">
                        {editingContactIdx === cIdx ? (
                          <div className="space-y-1.5">
                            {[
                              { placeholder: 'Name *', value: editContactName, set: setEditContactName },
                              { placeholder: 'Role / Title', value: editContactRole, set: setEditContactRole },
                              { placeholder: 'Email', value: editContactEmail, set: setEditContactEmail },
                              { placeholder: 'Phone', value: editContactPhone, set: setEditContactPhone },
                              { placeholder: 'LinkedIn URL', value: editContactSocial, set: setEditContactSocial },
                            ].map(({ placeholder, value, set }) => (
                              <input
                                key={placeholder}
                                type="text"
                                placeholder={placeholder}
                                value={value}
                                onChange={e => set(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[9.5px] text-white placeholder-slate-600 focus:outline-none focus:border-primary/40 font-sans"
                              />
                            ))}
                            <div className="flex gap-1.5 pt-0.5">
                              <button type="button" onClick={saveContactEdit} className="flex-1 py-1 bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-[8.5px] font-bold rounded cursor-pointer transition-all">Save</button>
                              <button type="button" onClick={() => setEditingContactIdx(null)} className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 text-[8.5px] rounded cursor-pointer transition-all">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-1">
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <span className="font-semibold text-slate-200 text-[10.5px] truncate">{contact.name}</span>
                                {contact.role && (
                                  <span className="text-[7px] uppercase tracking-widest text-primary font-bold px-1.5 py-0.5 bg-primary/10 rounded border border-primary/10 self-start font-mono">{contact.role}</span>
                                )}
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover/contact:opacity-100 transition-all shrink-0">
                                <button type="button" onClick={() => startEditingContact(cIdx)} className="p-0.5 hover:bg-white/10 text-slate-500 hover:text-white rounded transition-all cursor-pointer" title="Edit contact">
                                  <Edit3 className="h-2.5 w-2.5" />
                                </button>
                                <button type="button" onClick={() => handleDeleteContact(cIdx)} className="p-0.5 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded transition-all cursor-pointer" title="Remove contact">
                                  <Trash2 className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            </div>
                            <div className="space-y-1 text-[9px] text-slate-400 font-mono mt-1.5">
                              {contact.email && (
                                <div className="flex items-center gap-1.5 truncate">
                                  <Mail className="h-2.5 w-2.5 text-slate-600 shrink-0" />
                                  <span className="text-slate-300">{contact.email}</span>
                                </div>
                              )}
                              {contact.phone && (
                                <div className="flex items-center gap-1.5 truncate">
                                  <Phone className="h-2.5 w-2.5 text-slate-600 shrink-0" />
                                  <span>{contact.phone}</span>
                                </div>
                              )}
                              {contact.social && (
                                <a href={contact.social.startsWith("http") ? contact.social : `https://${contact.social}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[#0A66C2] hover:text-[#0A66C2]/80 transition-colors">
                                  <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                                  </svg>
                                  <span className="text-[9px] font-mono">LinkedIn</span>
                                </a>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Contact Selector Modal Overlay for populating target To: recipient */}
          {isContactSelectorOpen && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4 select-text">
              <div className="bg-[#0b0f19] border border-primary/25 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl relative select-text">
                <h4 className="text-[11px] font-bold font-mono text-primary uppercase tracking-wider">
                  Select Contact Recipient
                </h4>
                <p className="text-[10px] text-slate-400 leading-snug">
                  Choose a contact from{" "}
                  <strong className="text-white">{event.eventName}</strong> to
                  set as the "To" recipient for your outreach email.
                </p>

                <div className="space-y-2 max-h-[180px] overflow-y-auto custom-scrollbar select-text">
                  {(event.contacts || []).map((contact, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        if (pendingTemplateId) {
                          applyTemplateForContact(pendingTemplateId, contact);
                        } else {
                          setSelectedComposeContact(contact);
                        }
                        setIsContactSelectorOpen(false);
                        setPendingTemplateId(null);
                      }}
                      className="w-full text-left p-2.5 rounded-lg bg-white/[0.02] hover:bg-primary/10 border border-white/5 hover:border-primary/25 transition-all flex flex-col gap-0.5 group/item cursor-pointer"
                    >
                      <span className="text-xs font-semibold text-slate-200 group-hover/item:text-primary transition-colors">
                        {contact.name}
                      </span>
                      <span className="text-[7.5px] uppercase tracking-widest text-[#a855f7] font-mono">
                        {contact.role || "No Role Listed"}
                      </span>
                      {contact.email ? (
                        <span className="text-[9px] text-slate-400 font-mono mt-0.5 group-hover/item:text-white transition-colors">
                          {contact.email}
                        </span>
                      ) : (
                        <span className="text-[9px] text-red-400/60 font-mono mt-0.5 italic">
                          No email address on file
                        </span>
                      )}
                    </button>
                  ))}

                  {/* Option to proceed with no specific email */}
                  <button
                    type="button"
                    onClick={() => {
                      if (pendingTemplateId) {
                        applyTemplateForContact(pendingTemplateId, null);
                      } else {
                        setSelectedComposeContact(null);
                      }
                      setIsContactSelectorOpen(false);
                      setPendingTemplateId(null);
                    }}
                    className="w-full text-left p-2 rounded-lg bg-black/40 hover:bg-white/5 border border-dashed border-white/10 hover:border-white/20 transition-all flex flex-col items-center justify-center text-slate-450 hover:text-white cursor-pointer"
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                      Use "Team" (No recipient)
                    </span>
                    <span className="text-[7.5px] text-slate-500 font-mono">
                      Fill in To: field manually in draft
                    </span>
                  </button>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleCancelContactSelect}
                    className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/5 hover:border-white/10 rounded-lg text-[9px] font-bold cursor-pointer transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Select Email Client Modal */}
          {isMailClientSelectorOpen && (
            <div className="absolute inset-0 z-40 bg-zinc-950/90 flex items-center justify-center p-4">
              <div className="bg-[#0b0f19] border border-primary/25 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl relative select-text">
                <div>
                  <h6 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                    Select Email Client
                  </h6>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Choose how you would like to open this email draft.
                  </p>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      launchEmailClient("default");
                    }}
                    className="w-full text-left p-2.5 rounded-lg bg-white/[0.02] hover:bg-primary/10 border border-white/5 hover:border-primary/25 transition-all flex flex-col gap-0.5 group/item cursor-pointer"
                  >
                    <span className="text-xs font-semibold text-slate-200 group-hover/item:text-primary transition-colors">
                      Default Mail App
                    </span>
                    <span className="text-[9px] text-slate-455">
                      Opens Outlook, Mac Mail, Windows Mail (via mailto)
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      launchEmailClient("gmail");
                    }}
                    className="w-full text-left p-2.5 rounded-lg bg-white/[0.02] hover:bg-primary/10 border border-white/5 hover:border-primary/25 transition-all flex flex-col gap-0.5 group/item cursor-pointer"
                  >
                    <span className="text-xs font-semibold text-slate-200 group-hover/item:text-primary transition-colors">
                      Google Gmail (Web)
                    </span>
                    <span className="text-[9px] text-slate-455">
                      Opens compose window in mail.google.com
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      launchEmailClient("outlook");
                    }}
                    className="w-full text-left p-2.5 rounded-lg bg-white/[0.02] hover:bg-primary/10 border border-white/5 hover:border-primary/25 transition-all flex flex-col gap-0.5 group/item cursor-pointer"
                  >
                    <span className="text-xs font-semibold text-slate-200 group-hover/item:text-primary transition-colors">
                      Outlook Web (OWA)
                    </span>
                    <span className="text-[9px] text-slate-455">
                      Opens compose window in outlook.live.com
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      launchEmailClient("yahoo");
                    }}
                    className="w-full text-left p-2.5 rounded-lg bg-white/[0.02] hover:bg-primary/10 border border-white/5 hover:border-primary/25 transition-all flex flex-col gap-0.5 group/item cursor-pointer"
                  >
                    <span className="text-xs font-semibold text-slate-200 group-hover/item:text-primary transition-colors">
                      Yahoo Mail (Web)
                    </span>
                    <span className="text-[9px] text-slate-455">
                      Opens compose window in yahoo.com mail
                    </span>
                  </button>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      id={`remember_email_choice_${event.eventId}`}
                      className="rounded border-white/10 bg-zinc-900 text-primary focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                    />
                    <span className="text-[9px] text-slate-400 select-none">
                      Remember choice
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={() => setIsMailClientSelectorOpen(false)}
                    className="px-3 py-1 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/10 rounded-lg text-[9px] font-bold cursor-pointer transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
};

export default PipelineCard;
