import { Linking } from 'react-native';
import { ContactFormData } from '../types';

export class EmailService {
  static async sendContactEmail(data: ContactFormData): Promise<void> {
    const subject = this.getEmailSubject(data);
    const body = this.formatEmailBody(data);
    
    // Create the mailto URL
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    
    // Check if we can open the URL
    const canOpen = await Linking.canOpenURL(mailtoUrl);
    
    if (canOpen) {
      await Linking.openURL(mailtoUrl);
    } else {
      throw new Error('Unable to open email client');
    }
  }

  private static getEmailSubject(data: ContactFormData): string {
    const outcomeLabel = this.getOutcomeLabel(data.outcome);
    return `${outcomeLabel} - ${data.address}`;
  }

  private static getOutcomeLabel(outcome: 'lead' | 'callback' | 'sale'): string {
    switch (outcome) {
      case 'lead':
        return 'New Lead';
      case 'callback':
        return 'Follow Up Appointment';
      case 'sale':
        return 'Contract Signed';
      default:
        return 'Contact Form';
    }
  }

  private static formatEmailBody(data: ContactFormData): string {
    const outcomeLabel = this.getOutcomeLabel(data.outcome);
    const appointmentDate = data.appointmentTime.toLocaleDateString();
    const appointmentTime = data.appointmentTime.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    let body = `${outcomeLabel}\n`;
    body += `=====================================\n\n`;
    body += `Address: ${data.address}\n`;
    body += `Date: ${new Date().toLocaleDateString()}\n\n`;

    body += `CONTACT INFORMATION\n`;
    body += `-------------------\n`;

    if (data.fullName) {
      body += `Full Name: ${data.fullName}\n`;
    }
    if (data.goByName) {
      body += `Go-By Name: ${data.goByName}\n`;
    }
    body += `Phone: ${data.phone}\n`;
    
    if (data.email) {
      body += `Email: ${data.email}\n`;
    }
    
    if (data.insuranceCarrier) {
      body += `Insurance Carrier: ${data.insuranceCarrier}\n`;
    }

    body += `\nAPPOINTMENT\n`;
    body += `------------\n`;
    body += `Date: ${appointmentDate}\n`;
    body += `Time: ${appointmentTime}\n`;

    body += `\n=====================================\n`;
    body += `Sent from D2D Sales Tracker`;

    return body;
  }

  static formatContactSummary(data: ContactFormData): string {
    const name = data.fullName || data.goByName || 'No name';
    const phone = data.phone || 'No phone';
    return `${name} - ${phone}`;
  }
}