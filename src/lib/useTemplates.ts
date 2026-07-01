import { useEffect, useState, useCallback } from 'react';
import {
  collection, addDoc, deleteDoc, updateDoc, doc, onSnapshot, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  DEFAULT_TEMPLATE_ID, DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_TEXT, DEFAULT_TEMPLATE_SUBJECT,
} from './defaultTemplate';

export type TemplateScope = 'default' | 'personal' | 'shared';

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  text: string;
  scope: TemplateScope;
  ownerId?: string;
}

const BUILT_IN: EmailTemplate = {
  id: DEFAULT_TEMPLATE_ID,
  name: DEFAULT_TEMPLATE_NAME,
  subject: DEFAULT_TEMPLATE_SUBJECT,
  text: DEFAULT_TEMPLATE_TEXT,
  scope: 'default',
};

const MIGRATION_FLAG = 'templates_migrated_v1';

// Templates a user sees: the built-in default, all shared (admin) templates, and
// their own personal templates. Personal/shared live in Firestore so they sync
// across devices and (via the extension backend) into the Chrome extension.
export function useTemplates(uid: string | undefined, isAdmin: boolean) {
  const [shared, setShared] = useState<EmailTemplate[]>([]);
  const [personal, setPersonal] = useState<EmailTemplate[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'shared_templates'), snap => {
      setShared(snap.docs.map(d => ({
        id: d.id, name: d.data().name, subject: d.data().subject ?? DEFAULT_TEMPLATE_SUBJECT, text: d.data().text,
        scope: 'shared' as const, ownerId: d.data().createdBy,
      })));
    }, err => console.error('shared_templates listen failed:', err));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!uid) { setPersonal([]); return; }
    const unsub = onSnapshot(collection(db, 'users', uid, 'templates'), snap => {
      setPersonal(snap.docs.map(d => ({
        id: d.id, name: d.data().name, subject: d.data().subject ?? DEFAULT_TEMPLATE_SUBJECT, text: d.data().text,
        scope: 'personal' as const, ownerId: uid,
      })));
    }, err => console.error('personal templates listen failed:', err));
    return () => unsub();
  }, [uid]);

  // One-time migration of any templates previously stored in localStorage.
  // This hook runs in every PipelineCard, so claim the flag SYNCHRONOUSLY before
  // any async write — otherwise all mounted cards migrate at once and create
  // duplicates (the cause of the "same template x26" bug).
  useEffect(() => {
    if (!uid || localStorage.getItem(MIGRATION_FLAG)) return;
    localStorage.setItem(MIGRATION_FLAG, '1');
    const stored = localStorage.getItem('email_templates');
    if (!stored) return;
    (async () => {
      try {
        const arr = JSON.parse(stored) as Array<{ id?: string; name?: string; text?: string }>;
        const custom = arr.filter(t => t.id !== DEFAULT_TEMPLATE_ID && t.name && t.text);
        await Promise.all(custom.map(t =>
          addDoc(collection(db, 'users', uid, 'templates'), {
            name: t.name, text: t.text, createdAt: serverTimestamp(),
          })
        ));
      } catch (e) {
        console.error('Template migration failed:', e);
      }
    })();
  }, [uid]);

  const templates: EmailTemplate[] = [BUILT_IN, ...shared, ...personal];

  // Returns the new template's id so the caller can select it immediately.
  const createTemplate = useCallback(async (
    name: string, subject: string, text: string, shareWithAll: boolean, createdByName: string,
  ): Promise<string | null> => {
    if (!uid) return null;
    if (shareWithAll && isAdmin) {
      const ref = await addDoc(collection(db, 'shared_templates'), {
        name, subject, text, createdBy: uid, createdByName, createdAt: serverTimestamp(),
      });
      return ref.id;
    }
    const ref = await addDoc(collection(db, 'users', uid, 'templates'), {
      name, subject, text, createdAt: serverTimestamp(),
    });
    return ref.id;
  }, [uid, isAdmin]);

  const updateTemplate = useCallback(async (tpl: EmailTemplate, fields: { name: string; subject: string; text: string }) => {
    if (tpl.scope === 'default' || !uid) return;
    if (tpl.scope === 'shared') {
      await updateDoc(doc(db, 'shared_templates', tpl.id), fields);
    } else {
      await updateDoc(doc(db, 'users', uid, 'templates', tpl.id), fields);
    }
  }, [uid]);

  const deleteTemplate = useCallback(async (tpl: EmailTemplate) => {
    if (tpl.scope === 'default' || !uid) return;
    if (tpl.scope === 'shared') {
      await deleteDoc(doc(db, 'shared_templates', tpl.id));
    } else {
      await deleteDoc(doc(db, 'users', uid, 'templates', tpl.id));
    }
  }, [uid]);

  // Whether the current user may edit/delete a given template.
  const canEdit = useCallback((tpl: EmailTemplate) => {
    if (tpl.scope === 'default') return false;
    if (tpl.scope === 'shared') return isAdmin;
    return true; // personal templates are the user's own
  }, [isAdmin]);

  return { templates, createTemplate, updateTemplate, deleteTemplate, canDelete: canEdit, canEdit };
}
