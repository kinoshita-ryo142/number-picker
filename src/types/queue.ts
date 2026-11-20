export type TicketStatus = 'waiting' | 'calling' | 'done' | 'cancelled'

export interface Clinic {
  id: string
  owner_user_id: string
  name: string
  slug: string
  current_session_id: number
  created_at: string
}

export interface Ticket {
  id: string
  clinic_id: string
  session_id: number
  ticket_number: number
  passcode: string
  status: TicketStatus
  created_at: string
  called_at: string | null
  completed_at: string | null
}

export interface ClinicQueueState {
  clinic_id: string
  slug: string
  clinic_name: string
  session_id: number
  current_number: number | null
  waiting_count: number
  updated_at: string
}

export interface VerifiedTicketStatus {
  clinic_id: string
  clinic_name: string
  slug: string
  session_id: number
  ticket_number: number
  status: TicketStatus
  ahead_count: number
  current_number: number | null
  waiting_count: number
  updated_at: string
}
