import { db } from './index.ts';
import { users } from './schema.ts';
import { eq } from 'drizzle-orm';

export async function getOrCreateUser(uid: string, email: string, defaultPersona = 'Selvan') {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        activePersona: defaultPersona,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Failed to synchronize user profile with database.', { cause: error });
  }
}

export async function updateUserPersona(uid: string, activePersona: string) {
  try {
    const result = await db
      .update(users)
      .set({ activePersona })
      .where(eq(users.uid, uid))
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in updateUserPersona:', error);
    throw new Error('Failed to update active collaborator persona.', { cause: error });
  }
}
