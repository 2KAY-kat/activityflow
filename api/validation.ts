import { z } from 'zod';

export const authSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
});

export const teamSchema = z
  .object({
    name: z.string().min(2, 'Team name must be at least 2 characters long').max(80, 'Team name is too long'),
    sourceType: z.enum(['MANUAL', 'GITHUB']).default('MANUAL'),
    githubRepositoryId: z.number().int().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.sourceType === 'GITHUB' && !data.githubRepositoryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['githubRepositoryId'],
        message: 'A GitHub repository is required for GitHub-backed teams',
      });
    }
  });

export const ticketSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters long').max(100, 'Title too long'),
  description: z.string().optional().nullable(),
  status: z.enum(['To Do', 'In Progress', 'Done']).default('To Do'),
  priority: z.enum(['Low', 'Medium', 'High']).default('Medium'),
  assigneeId: z.number().int().optional().nullable(),
  assigneeCollaboratorId: z.number().int().optional().nullable(),
  teamId: z.number().int().optional().nullable(),
});

export const ticketUpdateSchema = ticketSchema.partial();

export type AuthInput = z.infer<typeof authSchema>;
export type TeamInput = z.infer<typeof teamSchema>;
export type TicketInput = z.infer<typeof ticketSchema>;
export type TicketUpdateInput = z.infer<typeof ticketUpdateSchema>;
