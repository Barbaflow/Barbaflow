export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_deletion_feedback: {
        Row: {
          created_at: string
          details: string | null
          had_barbershop_role: boolean
          id: string
          reason: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          had_barbershop_role?: boolean
          id?: string
          reason: string
        }
        Update: {
          created_at?: string
          details?: string | null
          had_barbershop_role?: boolean
          id?: string
          reason?: string
        }
        Relationships: []
      }
      account_deletions: {
        Row: {
          cancelled_at: string | null
          created_at: string
          details: string | null
          id: string
          processed_at: string | null
          reason: string | null
          scheduled_for: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          details?: string | null
          id?: string
          processed_at?: string | null
          reason?: string | null
          scheduled_for: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          details?: string | null
          id?: string
          processed_at?: string | null
          reason?: string | null
          scheduled_for?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
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
          cep: string | null
          city: string | null
          complement: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          neighborhood: string | null
          noshow_block_days: number
          noshow_max_count: number
          noshow_policy_enabled: boolean
          number: string | null
          owner_id: string | null
          pdf_slogan: string | null
          pdf_template: string | null
          plan_id: string
          primary_color: string
          qr_size: string | null
          rating_avg: number
          rating_count: number
          receipt_footer: string | null
          receipt_subtitle: string | null
          receipt_thank_you_message: string | null
          receipt_title: string | null
          receipt_whatsapp_intro: string | null
          reschedule_min_hours: number
          secondary_color: string
          state: string | null
          status: Database["public"]["Enums"]["approval_status"]
          street: string | null
          subdomain: string
          timezone: string
          updated_at: string
          whatsapp_message: string | null
        }
        Insert: {
          appointments_this_month?: number
          cancel_min_hours?: number
          cep?: string | null
          city?: string | null
          complement?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          neighborhood?: string | null
          noshow_block_days?: number
          noshow_max_count?: number
          noshow_policy_enabled?: boolean
          number?: string | null
          owner_id?: string | null
          pdf_slogan?: string | null
          pdf_template?: string | null
          plan_id?: string
          primary_color?: string
          qr_size?: string | null
          rating_avg?: number
          rating_count?: number
          receipt_footer?: string | null
          receipt_subtitle?: string | null
          receipt_thank_you_message?: string | null
          receipt_title?: string | null
          receipt_whatsapp_intro?: string | null
          reschedule_min_hours?: number
          secondary_color?: string
          state?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          street?: string | null
          subdomain: string
          timezone?: string
          updated_at?: string
          whatsapp_message?: string | null
        }
        Update: {
          appointments_this_month?: number
          cancel_min_hours?: number
          cep?: string | null
          city?: string | null
          complement?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          neighborhood?: string | null
          noshow_block_days?: number
          noshow_max_count?: number
          noshow_policy_enabled?: boolean
          number?: string | null
          owner_id?: string | null
          pdf_slogan?: string | null
          pdf_template?: string | null
          plan_id?: string
          primary_color?: string
          qr_size?: string | null
          rating_avg?: number
          rating_count?: number
          receipt_footer?: string | null
          receipt_subtitle?: string | null
          receipt_thank_you_message?: string | null
          receipt_title?: string | null
          receipt_whatsapp_intro?: string | null
          reschedule_min_hours?: number
          secondary_color?: string
          state?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          street?: string | null
          subdomain?: string
          timezone?: string
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
      client_notes: {
        Row: {
          barbershop_id: string
          client_id: string
          created_at: string
          created_by: string
          id: string
          note: string
          pinned: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          barbershop_id: string
          client_id: string
          created_at?: string
          created_by: string
          id?: string
          note: string
          pinned?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          barbershop_id?: string
          client_id?: string
          created_at?: string
          created_by?: string
          id?: string
          note?: string
          pinned?: boolean
          updated_at?: string
          updated_by?: string | null
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
      payment_methods: {
        Row: {
          active: boolean
          barbershop_id: string
          created_at: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          barbershop_id: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          barbershop_id?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
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
          anonymized_at: string | null
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          anonymized_at?: string | null
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          anonymized_at?: string | null
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
      ticket_items: {
        Row: {
          barbershop_id: string
          created_at: string
          description: string
          id: string
          item_type: string
          product_id: string | null
          quantity: number
          service_id: string | null
          ticket_id: string
          total: number
          unit_price: number
        }
        Insert: {
          barbershop_id: string
          created_at?: string
          description: string
          id?: string
          item_type: string
          product_id?: string | null
          quantity?: number
          service_id?: string | null
          ticket_id: string
          total?: number
          unit_price?: number
        }
        Update: {
          barbershop_id?: string
          created_at?: string
          description?: string
          id?: string
          item_type?: string
          product_id?: string | null
          quantity?: number
          service_id?: string | null
          ticket_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "ticket_items_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_payments: {
        Row: {
          amount: number
          barbershop_id: string
          created_at: string
          id: string
          method_name: string
          payment_method_id: string | null
          ticket_id: string
        }
        Insert: {
          amount: number
          barbershop_id: string
          created_at?: string
          id?: string
          method_name: string
          payment_method_id?: string | null
          ticket_id: string
        }
        Update: {
          amount?: number
          barbershop_id?: string
          created_at?: string
          id?: string
          method_name?: string
          payment_method_id?: string | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_payments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          appointment_id: string
          barber_id: string
          barbershop_id: string
          client_id: string
          closed_at: string
          closed_by: string
          created_at: string
          discount_amount: number
          discount_type: string
          id: string
          notes: string | null
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          appointment_id: string
          barber_id: string
          barbershop_id: string
          client_id: string
          closed_at?: string
          closed_by: string
          created_at?: string
          discount_amount?: number
          discount_type?: string
          id?: string
          notes?: string | null
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          barber_id?: string
          barbershop_id?: string
          client_id?: string
          closed_at?: string
          closed_by?: string
          created_at?: string
          discount_amount?: number
          discount_type?: string
          id?: string
          notes?: string | null
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: []
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
          cep: string | null
          city: string | null
          complement: string | null
          created_at: string | null
          id: string | null
          logo_url: string | null
          name: string | null
          neighborhood: string | null
          number: string | null
          primary_color: string | null
          rating_avg: number | null
          rating_count: number | null
          secondary_color: string | null
          state: string | null
          street: string | null
          subdomain: string | null
        }
        Insert: {
          cep?: string | null
          city?: string | null
          complement?: string | null
          created_at?: string | null
          id?: string | null
          logo_url?: string | null
          name?: string | null
          neighborhood?: string | null
          number?: string | null
          primary_color?: string | null
          rating_avg?: number | null
          rating_count?: number | null
          secondary_color?: string | null
          state?: string | null
          street?: string | null
          subdomain?: string | null
        }
        Update: {
          cep?: string | null
          city?: string | null
          complement?: string | null
          created_at?: string | null
          id?: string | null
          logo_url?: string | null
          name?: string | null
          neighborhood?: string | null
          number?: string | null
          primary_color?: string | null
          rating_avg?: number | null
          rating_count?: number | null
          secondary_color?: string | null
          state?: string | null
          street?: string | null
          subdomain?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_team_invitation: { Args: { _token: string }; Returns: Json }
      barbershop_is_system_sentinel: {
        Args: { _barbershop_id: string }
        Returns: boolean
      }
      check_appointment_limit: {
        Args: { _barbershop_id: string }
        Returns: boolean
      }
      check_barber_limit: { Args: { _barbershop_id: string }; Returns: boolean }
      check_client_noshow_block: {
        Args: { _barbershop_id: string; _client_id: string }
        Returns: Json
      }
      create_walkin_client: {
        Args: { _barbershop_id: string; _full_name: string; _phone?: string }
        Returns: string
      }
      default_free_plan_id: { Args: never; Returns: string }
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
      get_barbershop_clients: {
        Args: { _barbershop_id: string }
        Returns: {
          cancelled_count: number
          client_avatar: string
          client_id: string
          client_name: string
          client_phone: string
          completed_count: number
          first_appointment_at: string
          last_appointment_at: string
          manual_block_reason: string
          manual_blocked_until: string
          noshow_count: number
          total_appointments: number
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
      get_public_availability_windows: {
        Args: { _barber_id: string; _barbershop_id: string; _date: string }
        Returns: {
          end_time: string
          start_time: string
          status: string
        }[]
      }
      get_public_barbers: {
        Args: { _barbershop_id: string }
        Returns: {
          user_id: string
        }[]
      }
      get_public_busy_intervals: {
        Args: { _barber_id: string; _barbershop_id: string; _date: string }
        Returns: {
          end_time: string
          start_time: string
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
      is_trusted_backend: { Args: never; Returns: boolean }
      notify_expired_client_blocks: { Args: never; Returns: number }
      role_counts_toward_barber_limit: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      viewer_is_barbershop_staff: {
        Args: { _barbershop_id: string }
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
  graphql_public: {
    Enums: {},
  },
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

