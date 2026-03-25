import { z } from 'zod';

// Auth Schemas
export const authSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
});

// Ticket Schemas
export const ticketSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters long').max(100, 'Title too long'),
  description: z.string().optional().nullable(),
  status: z.enum(['To Do', 'In Progress', 'Done']).default('To Do'),
  priority: z.enum(['Low', 'Medium', 'High']).default('Medium'),
  assigneeId: z.number().int().optional().nullable(),
  teamId: z.number().int().optional().nullable(),
});

// Partial schema for updates (all fields optional)
export const ticketUpdateSchema = ticketSchema.partial();

export type AuthInput = z.infer<typeof authSchema>;
export type TicketInput = z.infer<typeof ticketSchema>;
export type TicketUpdateInput = z.infer<typeof ticketUpdateSchema>;
