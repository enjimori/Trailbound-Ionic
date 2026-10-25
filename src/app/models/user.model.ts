/**
 * Shared user and upcoming-adventure contracts: keep profile data consistent between account services and profile screens.
 */

export interface UpcomingAdventure {
  id: string;
  trailId: string;
  name: string;
  image: string;
  date: string;
  duration: string;
}

export interface UserProfile {
  name: string;
  location: string;
  bio: string;
  avatar: string;
  totalHikes: number;
  totalDistanceKm: number;
  highestPeakM: number;
  email: string;
  phone: string;
  dob: string;
  gender: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}
