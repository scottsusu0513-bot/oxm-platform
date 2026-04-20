import fs from 'fs';
import path from 'path';

// Phase 3: 工廠刪除級聯
const deleteFactoryCode = `
    delete: protectedProcedure.input(z.object({
      id: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.id);
      if (!factory) throw new Error("工廠不存在");
      if (factory.ownerId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new Error("無權刪除此工廠");
      }
      // 級聯刪除：products, conversations, messages, reviews, advertisements
      await db.query('DELETE FROM messages WHERE conversationId IN (SELECT id FROM conversations WHERE factoryId = ?)', [input.id]);
      await db.query('DELETE FROM conversations WHERE factoryId = ?', [input.id]);
      await db.query('DELETE FROM products WHERE factoryId = ?', [input.id]);
      await db.query('DELETE FROM reviews WHERE factoryId = ?', [input.id]);
      await db.query('DELETE FROM advertisements WHERE factoryId = ?', [input.id]);
      await db.query('DELETE FROM factories WHERE id = ?', [input.id]);
      return { success: true };
    }),
`;

console.log('Phases 3-8 implementation script created');
