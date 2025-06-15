import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// Date picker removed - using text input for better mobile UX
import { ContactFormData } from '../types';
import { CALENDLY_CONFIG } from '../config/calendly';

interface ContactFormProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: ContactFormData) => void;
  mode: 'full' | 'quick';
  outcome: 'lead' | 'callback' | 'sale';
  previousData?: ContactFormData;
  address: string;
}

export default function ContactForm({
  visible,
  onClose,
  onSubmit,
  mode,
  outcome,
  previousData,
  address,
}: ContactFormProps) {
  const [formData, setFormData] = useState<ContactFormData>({
    fullName: previousData?.fullName || '',
    goByName: previousData?.goByName || '',
    phone: previousData?.phone || '',
    email: previousData?.email || '',
    appointmentTime: previousData?.appointmentTime || new Date(),
    insuranceCarrier: previousData?.insuranceCarrier || '',
    outcome,
    address,
  });
  // Removed date picker state - using text input

  useEffect(() => {
    // Pre-fill data if it exists
    if (previousData) {
      setFormData({
        ...previousData,
        outcome,
        address,
      });
    }
  }, [previousData, outcome, address]);

  const handleSubmit = () => {
    onSubmit(formData);
    onClose();
  };

  const formatPhoneNumber = (text: string) => {
    const cleaned = text.replace(/\D/g, '');
    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
    if (match) {
      return `(${match[1]}) ${match[2]}-${match[3]}`;
    }
    return cleaned;
  };

  const getFormTitle = () => {
    switch (outcome) {
      case 'lead':
        return 'Lead Information';
      case 'callback':
        return 'Follow Up Details';
      case 'sale':
        return 'Contract Information';
      default:
        return 'Contact Form';
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>{getFormTitle()}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.form} showsVerticalScrollIndicator={false}>
            {mode === 'full' ? (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Full Name *</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.fullName}
                    onChangeText={(text) =>
                      setFormData({ ...formData, fullName: text })
                    }
                    placeholder="John Smith"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Phone Number *</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.phone}
                    onChangeText={(text) =>
                      setFormData({ ...formData, phone: formatPhoneNumber(text) })
                    }
                    placeholder="(555) 123-4567"
                    keyboardType="phone-pad"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Email Address</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.email}
                    onChangeText={(text) =>
                      setFormData({ ...formData, email: text })
                    }
                    placeholder="john@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Insurance Carrier</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.insuranceCarrier}
                    onChangeText={(text) =>
                      setFormData({ ...formData, insuranceCarrier: text })
                    }
                    placeholder="State Farm, Allstate, etc."
                  />
                </View>
              </>
            ) : (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Go-By Name *</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.goByName}
                    onChangeText={(text) =>
                      setFormData({ ...formData, goByName: text })
                    }
                    placeholder="John"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Phone Number *</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.phone}
                    onChangeText={(text) =>
                      setFormData({ ...formData, phone: formatPhoneNumber(text) })
                    }
                    placeholder="(555) 123-4567"
                    keyboardType="phone-pad"
                  />
                </View>
              </>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Appointment Scheduling</Text>
              
              {/* Calendly Integration */}
              <TouchableOpacity
                style={styles.calendlyCard}
                onPress={() => {
                  // Pre-fill Calendly with customer info
                  const calendlyBase = CALENDLY_CONFIG.schedulingUrl;
                  const params = new URLSearchParams();
                  
                  // Pre-fill name and email if available
                  if (mode === 'full' && formData.fullName) {
                    params.append('name', formData.fullName);
                  } else if (formData.goByName) {
                    params.append('name', formData.goByName);
                  }
                  
                  if (formData.email) {
                    params.append('email', formData.email);
                  }
                  
                  // Add custom questions/notes
                  const notes = `Phone: ${formData.phone}\nAddress: ${address}`;
                  params.append('a1', notes);
                  
                  const calendlyUrl = `${calendlyBase}?${params.toString()}`;
                  
                  Alert.alert(
                    'Schedule with Calendly',
                    'Opening Calendly to schedule the appointment. The customer\'s information will be pre-filled.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { 
                        text: 'Open Calendly', 
                        onPress: () => {
                          Linking.openURL(calendlyUrl);
                          // Auto-fill appointment time field
                          setFormData({ 
                            ...formData, 
                            appointmentTime: 'Scheduled via Calendly' 
                          });
                        }
                      },
                    ]
                  );
                }}
              >
                <View style={styles.calendlyIcon}>
                  <Ionicons name="calendar" size={24} color="#1e40af" />
                </View>
                <View style={styles.calendlyContent}>
                  <Text style={styles.calendlyTitle}>Schedule with Calendly</Text>
                  <Text style={styles.calendlySubtitle}>Tap to open your booking calendar</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
              </TouchableOpacity>
              
              {/* Manual entry option */}
              <View style={styles.orDivider}>
                <View style={styles.orLine} />
                <Text style={styles.orText}>OR</Text>
                <View style={styles.orLine} />
              </View>
              
              <Text style={styles.subLabel}>Enter appointment manually</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Tomorrow 2:00 PM"
                value={typeof formData.appointmentTime === 'string' 
                  ? formData.appointmentTime 
                  : formData.appointmentTime.toLocaleString()}
                onChangeText={(text) => setFormData({ ...formData, appointmentTime: text })}
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={onClose}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.submitButton]}
              onPress={handleSubmit}
            >
              <Text style={styles.submitButtonText}>Save & Send Email</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 20,
    width: '90%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1f2937',
  },
  form: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#1f2937',
  },
  calendlyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  calendlyIcon: {
    width: 44,
    height: 44,
    backgroundColor: '#1e40af',
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  calendlyContent: {
    flex: 1,
  },
  calendlyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 2,
  },
  calendlySubtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  orDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e5e7eb',
  },
  orText: {
    marginHorizontal: 16,
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '500',
  },
  subLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 8,
  },
  footer: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  button: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    marginRight: 8,
    backgroundColor: '#f3f4f6',
  },
  submitButton: {
    marginLeft: 8,
    backgroundColor: '#1e40af',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
});