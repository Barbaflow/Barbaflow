export interface Service {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  barber_id: string;
}

export interface AvailabilitySlot {
  id: string;
  barber_id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
}

export interface Barber {
  user_id: string;
}
