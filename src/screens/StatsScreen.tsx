import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
} from 'react-native';
import {
  LineChart,
  BarChart,
  PieChart,
} from 'react-native-chart-kit';
import { StorageService } from '../services/storageService';
import { Knock, DailyStats } from '../types';
import { format, subDays, startOfDay } from 'date-fns';

const screenWidth = Dimensions.get('window').width;

export default function StatsScreen() {
  const [knocks, setKnocks] = useState<Knock[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [knocksData, statsData] = await Promise.all([
      StorageService.getKnocks(),
      StorageService.getDailyStats(),
    ]);
    setKnocks(knocksData);
    setDailyStats(statsData);
    setLoading(false);
  };

  const getOutcomeStats = () => {
    const outcomes = knocks.reduce((acc, knock) => {
      acc[knock.outcome] = (acc[knock.outcome] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return [
      { name: 'Sales', population: outcomes.sale || 0, color: '#22c55e', legendFontColor: '#7F7F7F' },
      { name: 'Leads', population: outcomes.lead || 0, color: '#eab308', legendFontColor: '#7F7F7F' },
      { name: 'Callbacks', population: outcomes.callback || 0, color: '#f59e0b', legendFontColor: '#7F7F7F' },
      { name: 'Not Home', population: outcomes.not_home || 0, color: '#6b7280', legendFontColor: '#7F7F7F' },
      { name: 'Not Interested', population: outcomes.not_interested || 0, color: '#991b1b', legendFontColor: '#7F7F7F' },
    ];
  };

  const getLast7DaysData = () => {
    const labels = [];
    const knocksData = [];
    const contactsData = [];

    for (let i = 6; i >= 0; i--) {
      const date = startOfDay(subDays(new Date(), i));
      const dayStats = dailyStats.find(
        s => new Date(s.date).toDateString() === date.toDateString()
      );

      labels.push(format(date, 'EEE'));
      knocksData.push(dayStats?.knocks || 0);
      contactsData.push(dayStats?.contacts || 0);
    }

    return {
      labels,
      datasets: [
        {
          data: knocksData,
          color: (opacity = 1) => `rgba(30, 64, 175, ${opacity})`,
          strokeWidth: 2,
        },
        {
          data: contactsData,
          color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
          strokeWidth: 2,
        },
      ],
      legend: ['Knocks', 'Contacts'],
    };
  };

  const getTodayStats = () => {
    const today = dailyStats.find(
      s => new Date(s.date).toDateString() === new Date().toDateString()
    );
    return today || { knocks: 0, contacts: 0, leads: 0, sales: 0 };
  };

  const getConversionRate = () => {
    const totalKnocks = knocks.length;
    const totalSales = knocks.filter(k => k.outcome === 'sale').length;
    return totalKnocks > 0 ? ((totalSales / totalKnocks) * 100).toFixed(1) : '0';
  };

  const getContactRate = () => {
    const totalKnocks = knocks.length;
    const contacts = knocks.filter(k => 
      ['lead', 'sale', 'callback', 'not_interested'].includes(k.outcome)
    ).length;
    return totalKnocks > 0 ? ((contacts / totalKnocks) * 100).toFixed(1) : '0';
  };

  const todayStats = getTodayStats();

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.kpiSection}>
        <Text style={styles.sectionTitle}>Today's Performance</Text>
        <View style={styles.kpiGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{todayStats.knocks}</Text>
            <Text style={styles.kpiLabel}>Knocks</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{todayStats.contacts}</Text>
            <Text style={styles.kpiLabel}>Contacts</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{todayStats.leads}</Text>
            <Text style={styles.kpiLabel}>Leads</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{todayStats.sales}</Text>
            <Text style={styles.kpiLabel}>Sales</Text>
          </View>
        </View>
      </View>

      <View style={styles.ratesSection}>
        <View style={styles.rateCard}>
          <Text style={styles.rateValue}>{getContactRate()}%</Text>
          <Text style={styles.rateLabel}>Contact Rate</Text>
        </View>
        <View style={styles.rateCard}>
          <Text style={styles.rateValue}>{getConversionRate()}%</Text>
          <Text style={styles.rateLabel}>Conversion Rate</Text>
        </View>
      </View>

      <View style={styles.chartSection}>
        <Text style={styles.sectionTitle}>Last 7 Days</Text>
        <LineChart
          data={getLast7DaysData()}
          width={screenWidth - 32}
          height={220}
          chartConfig={{
            backgroundColor: '#ffffff',
            backgroundGradientFrom: '#ffffff',
            backgroundGradientTo: '#ffffff',
            decimalPlaces: 0,
            color: (opacity = 1) => `rgba(30, 64, 175, ${opacity})`,
            labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
            style: {
              borderRadius: 16,
            },
            propsForDots: {
              r: '6',
              strokeWidth: '2',
              stroke: '#1e40af',
            },
          }}
          bezier
          style={styles.chart}
        />
      </View>

      <View style={styles.chartSection}>
        <Text style={styles.sectionTitle}>Outcome Distribution</Text>
        <PieChart
          data={getOutcomeStats()}
          width={screenWidth - 32}
          height={220}
          chartConfig={{
            color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
          }}
          accessor="population"
          backgroundColor="transparent"
          paddingLeft="15"
          absolute
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  kpiSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#1f2937',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  kpiCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    width: '48%',
    marginBottom: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  kpiValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1e40af',
  },
  kpiLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  ratesSection: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  rateCard: {
    backgroundColor: '#1e40af',
    borderRadius: 12,
    padding: 20,
    width: '48%',
    alignItems: 'center',
  },
  rateValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  rateLabel: {
    fontSize: 14,
    color: 'white',
    marginTop: 4,
    opacity: 0.9,
  },
  chartSection: {
    padding: 16,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
});