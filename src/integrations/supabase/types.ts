export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          barber_id: string
          barbershop_id: string
          client_id: string
          created_at: string
          date: string
          end_time: string
          id: string
          notes: string | null
          service_id: string
          start_time: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          barber_id: string
          barbershop_id: string
          client_id: string
          created_at?: string
          date: string
          end_time: string
          id?: string
          notes?: string | null
          service_id: string
          start_time: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          barber_id?: string
          barbershop_id?: string
          client_id?: string
          created_at?: string
          date?: string
          end_time?: string
          id?: string
          notes?: string | null
          service_id?: string
          start_time?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbearias_publicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      availability: {
        Row: {
          barber_id: string
          barbershop_id: string
          created_at: string
          date: string
          end_time: string
          id: string
          start_time: string
          status: Database["public"]["Enums"]["availability_status"]
          updated_at: string
        }
        Insert: {
          barber_id: string
          barbershop_id: string
          created_at?: string
          date: string
          end_time: string
          id?: string
          start_time: string
          status?: Database["public"]["Enums"]["availability_status"]
          updated_at?: string
        }
        Update: {
          barber_id?: string
          barbershop_id?: string
          created_at?: string
          date?: string
          end_time?: string
          id?: string
          start_time?: string
          status?: Database["public"]["Enums"]["availability_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbearias_publicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      barbershops: {
        Row: {
          appointments_this_month: number
          cancel_min_hours: number
          created_at: string
          id: string
          logo_url: string | null
          name: string
          noshow_block_days: number
          noshow_max_count: number
          noshow_policy_enabled: boolean
          owner_id: string | null
          pdf_slogan: string | null
          pdf_template: string | null
          plan_id: string | null
          primary_color: string
          qr_size: string | null
          rating_avg: number
          rating_count: number
          reschedule_min_hours: number
          secondary_color: string
          status: Database["public"]["Enums"]["approval_status"]
          subdomain: string
          updated_at: string
          whatsapp_message: string | null
        }
        Insert: {
          appointments_this_month?: number
          cancel_min_hours?: number
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          noshow_block_days?: number
          noshow_max_count?: number
          noshow_policy_enabled?: boolean
          owner_id?: string | null
          pdf_slogan?: string | null
          pdf_template?: string | null
          plan_id?: string | null
          primary_color?: string
          qr_size?: string | null
          rating_avg?: number
          rating_count?: number
          reschedule_min_hours?: number
          secondary_color?: string
          status?: Database["public"]["Enums"]["approval_status"]
          subdomain: string
          updated_at?: string
          whatsapp_message?: string | null
        }
        Update: {
          appointments_this_month?: number
          cancel_min_hours?: number
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          noshow_block_days?: number
          noshow_max_count?: number
          noshow_policy_enabled?: boolean
          owner_id?: string | null
          pdf_slogan?: string | null
          pdf_template?: string | null
          plan_id?: string | null
          primary_color?: string
          qr_size?: string | null
          rating_avg?: number
          rating_count?: number
          reschedule_min_hours?: number
          secondary_color?: string
          status?: Database["public"]["Enums"]["approval_status"]
          subdomain?: string
          updated_at?: string
          whatsapp_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "barbershops_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      client_blocks: {
        Row: {
          barbershop_id: string
          blocked_by: string
          blocked_until: string
          client_id: string
          created_at: string
          id: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          barbershop_id: string
          blocked_by: string
          blocked_until: string
          client_id: string
          created_at?: string
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          barbershop_id?: string
          blocked_by?: string
          blocked_until?: string
          client_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      contact_submissions: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          appointment_id: string | null
          barbershop_id: string
          created_at: string
          id: string
          message: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          appointment_id?: string | null
          barbershop_id: string
          created_at?: string
          id?: string
          message: string
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          appointment_id?: string | null
          barbershop_id?: string
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbearias_publicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_change_logs: {
        Row: {
          barbershop_id: string
          changed_by: string
          created_at: string
          id: string
          new_plan_id: string
          old_plan_id: string | null
        }
        Insert: {
          barbershop_id: string
          changed_by: string
          created_at?: string
          id?: string
          new_plan_id: string
          old_plan_id?: string | null
        }
        Update: {
          barbershop_id?: string
          changed_by?: string
          created_at?: string
          id?: string
          new_plan_id?: string
          old_plan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_change_logs_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbearias_publicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_change_logs_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_change_logs_new_plan_id_fkey"
            columns: ["new_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_change_logs_old_plan_id_fkey"
            columns: ["old_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          appointment_limit: number | null
          barber_limit: number | null
          created_at: string
          has_subscriptions: boolean
          id: string
          name: Database["public"]["Enums"]["plan_name"]
          price: number
          updated_at: string
        }
        Insert: {
          appointment_limit?: number | null
          barber_limit?: number | null
          created_at?: string
          has_subscriptions?: boolean
          id?: string
          name: Database["public"]["Enums"]["plan_name"]
          price?: number
          updated_at?: string
        }
        Update: {
          appointment_limit?: number | null
          barber_limit?: number | null
          created_at?: string
          has_subscriptions?: boolean
          id?: string
          name?: Database["public"]["Enums"]["plan_name"]
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          barbershop_id: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          name: string
          price: number
          stock_quantity: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          barbershop_id: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          price?: number
          stock_quantity?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          barbershop_id?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          price?: number
          stock_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbearias_publicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          appointment_id: string | null
          barbershop_id: string
          client_id: string
          comment: string | null
          created_at: string
          id: string
          rating: number
          replied_by: string | null
          reply: string | null
          reply_at: string | null
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          barbershop_id: string
          client_id: string
          comment?: string | null
          created_at?: string
          id?: string
          rating: number
          replied_by?: string | null
          reply?: string | null
          reply_at?: string | null
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          barbershop_id?: string
          client_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          rating?: number
          replied_by?: string | null
          reply?: string | null
          reply_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbearias_publicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_blocks: {
        Row: {
          barber_id: string
          barbershop_id: string
          block_date: string
          block_type: Database["public"]["Enums"]["block_type"]
          created_at: string
          id: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          barber_id: string
          barbershop_id: string
          block_date: string
          block_type?: Database["public"]["Enums"]["block_type"]
          created_at?: string
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          barber_id?: string
          barbershop_id?: string
          block_date?: string
          block_type?: Database["public"]["Enums"]["block_type"]
          created_at?: string
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_blocks_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbearias_publicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_blocks_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean
          barber_id: string
          barbershop_id: string
          created_at: string
          duration_minutes: number
          id: string
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          barber_id: string
          barbershop_id: string
          created_at?: string
          duration_minutes?: number
          id?: string
          name: string
          price?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          barber_id?: string
          barbershop_id?: string
          created_at?: string
          duration_minutes?: number
          id?: string
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbearias_publicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          paddle_customer_id: string
          paddle_subscription_id: string
          price_id: string
          product_id: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          paddle_customer_id: string
          paddle_subscription_id: string
          price_id: string
          product_id: string
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          paddle_customer_id?: string
          paddle_subscription_id?: string
          price_id?: string
          product_id?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      team_invitations: {
        Row: {
          barbershop_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          barbershop_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          barbershop_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_invitations_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbearias_publicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_invitations_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          barbershop_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          barbershop_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          barbershop_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbearias_publicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_schedule: {
        Row: {
          barber_id: string
          barbershop_id: string
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean
          start_time: string
          updated_at: string
        }
        Insert: {
          barber_id: string
          barbershop_id: string
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          is_active?: boolean
          start_time: string
          updated_at?: string
        }
        Update: {
          barber_id?: string
          barbershop_id?: string
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_schedule_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbearias_publicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_schedule_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      barbearias_publicas: {
        Row: {
          created_at: string | null
          id: string | null
          logo_url: string | null
          name: string | null
          primary_color: string | null
          rating_avg: number | null
          rating_count: number | null
          secondary_color: string | null
          subdomain: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          logo_url?: string | null
          name?: string | null
          primary_color?: string | null
          rating_avg?: number | null
          rating_count?: number | null
          secondary_color?: string | null
          subdomain?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          logo_url?: string | null
          name?: string | null
          primary_color?: string | null
          rating_avg?: number | null
          rating_count?: number | null
          secondary_color?: string | null
          subdomain?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_team_invitation: { Args: { _token: string }; Returns: Json }
      check_appointment_limit: {
        Args: { _barbershop_id: string }
        Returns: boolean
      }
      check_barber_limit: { Args: { _barbershop_id: string }; Returns: boolean }
      check_client_noshow_block: {
        Args: { _barbershop_id: string; _client_id: string }
        Returns: Json
      }
      generate_availability_from_schedule: {
        Args: {
          _barber_id: string
          _barbershop_id: string
          _end_date: string
          _start_date: string
        }
        Returns: number
      }
      get_barber_display_names: {
        Args: { _user_ids: string[] }
        Returns: {
          avatar_url: string
          display_name: string
          user_id: string
        }[]
      }
      get_client_phone: { Args: { _client_id: string }; Returns: string }
      get_noshow_report: {
        Args: { _barbershop_id: string; _days?: number }
        Returns: {
          client_avatar: string
          client_id: string
          client_name: string
          last_noshow_at: string
          manual_block_reason: string
          manual_blocked_until: string
          noshow_count: number
          total_appointments: number
        }[]
      }
      get_public_barbers: {
        Args: { _barbershop_id: string }
        Returns: {
          user_id: string
        }[]
      }
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role_in_barbershop: {
        Args: {
          _barbershop_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "cliente" | "barbeiro" | "admin_barbearia" | "super_admin"
      appointment_status: "scheduled" | "completed" | "cancelled" | "no_show"
      approval_status: "pending" | "approved" | "rejected"
      availability_status: "livre" | "ocupado" | "folga"
      block_type: "feriado" | "ferias" | "pessoal"
      plan_name: "free" | "pro" | "enterprise"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["cliente", "barbeiro", "admin_barbearia", "super_admin"],
      appointment_status: ["scheduled", "completed", "cancelled", "no_show"],
      approval_status: ["pending", "approved", "rejected"],
      availability_status: ["livre", "ocupado", "folga"],
      block_type: ["feriado", "ferias", "pessoal"],
      plan_name: ["free", "pro", "enterprise"],
    },
  },
} as const
