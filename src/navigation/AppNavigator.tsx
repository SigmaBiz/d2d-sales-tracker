import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';

import RealMapScreen from '../screens/RealMapScreen';
import StatsScreen from '../screens/StatsScreen';
import LeadLogScreen from '../screens/LeadLogScreen';
import SettingsScreen from '../screens/SettingsScreen';
import StormSearchScreen from '../screens/StormSearchScreen';
import DataFlowDashboard from '../screens/DataFlowDashboard';
import HailIntelligenceDashboard from '../screens/HailIntelligenceDashboard';
import PingHistoryScreen from '../screens/PingHistoryScreen';
import AuthScreen from '../screens/AuthScreen';
import TeamSetupScreen from '../screens/TeamSetupScreen';
import { SupabaseService } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';
import { HailAlertService } from '../services/hailAlertService';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap;

          if (route.name === 'Map') {
            iconName = focused ? 'map' : 'map-outline';
          } else if (route.name === 'Log') {
            iconName = focused ? 'list' : 'list-outline';
          } else if (route.name === 'Stats') {
            iconName = focused ? 'stats-chart' : 'stats-chart-outline';
          } else if (route.name === 'Settings') {
            iconName = focused ? 'settings' : 'settings-outline';
          } else {
            iconName = 'alert-circle';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#1e40af',
        tabBarInactiveTintColor: 'gray',
        headerStyle: {
          backgroundColor: '#1e40af',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      })}
    >
      <Tab.Screen name="Map" component={RealMapScreen} options={{ title: 'Territory Map' }} />
      <Tab.Screen name="Log" component={LeadLogScreen} options={{ title: 'Lead Log' }} />
      <Tab.Screen name="Stats" component={StatsScreen} options={{ title: 'Analytics' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}

function MainStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen 
        name="Main" 
        component={TabNavigator} 
        options={{ headerShown: false }}
      />
      <Stack.Screen 
        name="StormSearch" 
        component={StormSearchScreen}
        options={{ 
          title: 'Storm History',
          headerStyle: {
            backgroundColor: '#1e40af',
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      />
      <Stack.Screen 
        name="DataFlow" 
        component={DataFlowDashboard}
        options={{ 
          title: 'Data Flow Monitor',
          headerStyle: {
            backgroundColor: '#1e40af',
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      />
      <Stack.Screen
        name="HailIntelligence"
        component={HailIntelligenceDashboard}
        options={{
          title: 'Hail Intelligence',
          headerStyle: { backgroundColor: '#1e40af' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      />
      <Stack.Screen
        name="PingHistory"
        component={PingHistoryScreen}
        options={{
          title: 'Ping History',
          headerStyle: { backgroundColor: '#1e40af' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'team_setup' | 'unauthenticated'>('loading');

  useEffect(() => {
    SupabaseService.initialize().then(async authenticated => {
      if (!authenticated) {
        setAuthState('unauthenticated');
        return;
      }
      const teamSetupDone = await SupabaseService.isTeamSetupDone();
      setAuthState(teamSetupDone ? 'authenticated' : 'team_setup');
    });

    // React to auth changes (sign-out/in) instead of only checking once at launch.
    // Platform-guaranteed signal — keeps the UI truthful: sign-out returns to the
    // auth screen immediately, and a fresh sign-in lands on Team Setup when needed.
    const { data: sub } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_OUT') {
        // Stop this device receiving pushes for the account that just left.
        HailAlertService.deactivateToken().catch(() => {});
        setAuthState('unauthenticated');
      } else if (event === 'SIGNED_IN') {
        await SupabaseService.initialize();
        // Re-bind this device's push token to the new user (one device = current user).
        HailAlertService.registerPushToken().catch(() => {});
        const teamSetupDone = await SupabaseService.isTeamSetupDone();
        setAuthState(teamSetupDone ? 'authenticated' : 'team_setup');
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (authState === 'loading') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1e40af' }}>
        <ActivityIndicator size="large" color="white" />
      </View>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <AuthScreen onAuthenticated={async () => {
        const teamSetupDone = await SupabaseService.isTeamSetupDone();
        setAuthState(teamSetupDone ? 'authenticated' : 'team_setup');
      }} />
    );
  }

  if (authState === 'team_setup') {
    return <TeamSetupScreen onComplete={() => setAuthState('authenticated')} />;
  }

  return (
    <NavigationContainer>
      <MainStack />
    </NavigationContainer>
  );
}