// Calendly Configuration
// Update this with your actual Calendly URL

export const CALENDLY_CONFIG = {
  // Replace with your Calendly scheduling link
  schedulingUrl: 'https://calendly.com/aescalante-oksigma/new-meeting',
  
  // Optional: Different links for different appointment types
  appointmentTypes: {
    inspection: 'https://calendly.com/aescalante-oksigma/new-meeting',
    estimate: 'https://calendly.com/aescalante-oksigma/new-meeting',
    followUp: 'https://calendly.com/aescalante-oksigma/new-meeting',
  },
  
  // Pre-fill parameter names (these may vary based on your Calendly setup)
  params: {
    name: 'name',
    email: 'email',
    notes: 'a1', // Custom question field for additional info
  }
};