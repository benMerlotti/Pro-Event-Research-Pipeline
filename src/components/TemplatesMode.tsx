import React, { useState, useRef } from 'react';
import { useFirebase } from './FirebaseProvider';
import { useTemplates, EmailTemplate } from '@/src/lib/useTemplates';
import { DEFAULT_TEMPLATE_SUBJECT } from '@/src/lib/defaultTemplate';
import { cn } from '@/src/lib/utils';
import { FileText, Plus, Pencil, Trash2, Lock, Users, User as UserIcon } from 'lucide-react';

// Placeholders the composer auto-fills from each event/contact when sending.
const PLACEHOLDERS = ['[Contact Name]', '[Event Name]', '[Vendor Name]', '[Location]', '[Month]', '[Salesperson]', '[Website]'];

const ScopeBadge: React.FC<{ scope: EmailTemplate['scope'] }> = ({ scope }) => {
  if (scope === 'shared') return (
    <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded px-1.5 py-0.5"><Users className="h-2.5 w-2.5" />Shared</span>
  );
  if (scope === 'default') return (
    <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold text-slate-400 bg-white/5 border border-white/10 rounded px-1.5 py-0.5"><Lock className="h-2.5 w-2.5" />Default</span>
  );
  return (
    <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5"><UserIcon className="h-2.5 w-2.5" />Personal</span>
  );
};

const TemplatesMode: React.FC = () => {
  const { user, profile } = useFirebase();
  const isAdmin = profile?.role === 'admin';
  const { templates, createTemplate, updateTemplate, deleteTemplate, canEdit } = useTemplates(user?.uid, isAdmin);

  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [shareWithAll, setShareWithAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  // Which field a placeholder click should insert into.
  const lastFocused = useRef<'subject' | 'body'>('body');

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <p>Only admins can manage templates.</p>
      </div>
    );
  }

  const isFormOpen = creating || !!editing;

  const startCreate = () => { setCreating(true); setEditing(null); setName(''); setSubject(DEFAULT_TEMPLATE_SUBJECT); setText(''); setShareWithAll(false); setError(''); };
  const startEdit = (t: EmailTemplate) => { setEditing(t); setCreating(false); setName(t.name); setSubject(t.subject || DEFAULT_TEMPLATE_SUBJECT); setText(t.text); setShareWithAll(t.scope === 'shared'); setError(''); };
  const cancel = () => { setCreating(false); setEditing(null); setName(''); setSubject(''); setText(''); setError(''); };

  const insertPlaceholder = (ph: string) => {
    if (lastFocused.current === 'subject') {
      const el = subjectRef.current;
      if (!el) { setSubject(s => s + ph); return; }
      const start = el.selectionStart ?? subject.length;
      const end = el.selectionEnd ?? subject.length;
      setSubject(subject.slice(0, start) + ph + subject.slice(end));
      requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + ph.length; });
    } else {
      const el = textRef.current;
      if (!el) { setText(t => t + ph); return; }
      const start = el.selectionStart ?? text.length;
      const end = el.selectionEnd ?? text.length;
      setText(text.slice(0, start) + ph + text.slice(end));
      requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + ph.length; });
    }
  };

  const save = async () => {
    if (!name.trim()) { setError('Enter a template name.'); return; }
    if (!subject.trim()) { setError('Enter a subject line.'); return; }
    if (!text.trim()) { setError('Enter the template body.'); return; }
    setSaving(true); setError('');
    try {
      if (editing) {
        await updateTemplate(editing, { name: name.trim(), subject: subject.trim(), text });
      } else {
        await createTemplate(name.trim(), subject.trim(), text, shareWithAll, profile?.displayName || '');
      }
      cancel();
    } catch (e: any) {
      setError(e?.message || 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 select-text">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2"><FileText className="h-5 w-5 text-sky-400" />Email Templates</h2>
          <p className="text-sm text-slate-400 mt-0.5">Create outreach templates with placeholders that auto-fill for each contact.</p>
        </div>
        {!isFormOpen && (
          <button
            onClick={startCreate}
            className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/90 hover:bg-primary text-white text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" /> New Template
          </button>
        )}
      </div>

      {isFormOpen ? (
        <div className="glass rounded-2xl border border-white/10 p-5 space-y-4 max-w-3xl">
          <h3 className="text-sm font-semibold text-white">{editing ? 'Edit Template' : 'New Template'}</h3>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Event Introduction"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Subject</label>
            <input
              ref={subjectRef}
              value={subject}
              onFocus={() => { lastFocused.current = 'subject'; }}
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Event video coverage for [Event Name]"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Body</label>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-slate-500 mr-1">Insert:</span>
              {PLACEHOLDERS.map(ph => (
                <button
                  key={ph}
                  type="button"
                  onClick={() => insertPlaceholder(ph)}
                  className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors"
                >
                  {ph}
                </button>
              ))}
            </div>
            <textarea
              ref={textRef}
              value={text}
              onFocus={() => { lastFocused.current = 'body'; }}
              onChange={e => setText(e.target.value)}
              rows={14}
              placeholder="Write your template. Click a placeholder above to insert it at the cursor."
              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 leading-relaxed focus:outline-none focus:border-primary/50 custom-scrollbar resize-y font-sans"
            />
            <p className="text-[11px] text-slate-500">Placeholders like <span className="font-mono text-slate-400">[Contact Name]</span> and <span className="font-mono text-slate-400">[Month]</span> auto-fill from the event and contact when composing.</p>
          </div>

          {editing ? (
            <p className="text-xs text-slate-500 flex items-center gap-1.5">Scope: <ScopeBadge scope={editing.scope} /></p>
          ) : (
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
              <input type="checkbox" checked={shareWithAll} onChange={e => setShareWithAll(e.target.checked)} className="h-4 w-4 accent-sky-500 cursor-pointer" />
              Share with all salespeople
            </label>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-primary/90 hover:bg-primary text-white text-sm font-medium disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Template'}
            </button>
            <button onClick={cancel} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm transition-colors">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map(t => (
            <div key={t.id} className="glass rounded-xl border border-white/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-white truncate">{t.name}</span>
                  <ScopeBadge scope={t.scope} />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {canEdit(t) && (
                    <>
                      <button onClick={() => startEdit(t)} title="Edit" className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                      <button
                        onClick={() => { if (confirm(`Delete template "${t.name}"${t.scope === 'shared' ? ' for ALL salespeople' : ''}?`)) deleteTemplate(t); }}
                        title="Delete"
                        className="p-1.5 rounded-md text-red-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      ><Trash2 className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-2 whitespace-pre-wrap line-clamp-3">{t.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TemplatesMode;
