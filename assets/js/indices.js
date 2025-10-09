import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const IndicesDashboard = () => {
  const [activeIndices, setActiveIndices] = useState(['SPY', 'EWG', 'EWJ']);
  const [timeRange, setTimeRange] = useState('YTD');
  const [viewMode, setViewMode] = useState('Base100');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  // Configuración de índices disponibles
  const indices = [
    { id: 'SPY', name: 'S&P 500', color: '#3b82f6' },
    { id: 'EWG', name: 'Alemania', color: '#10b981' },
    { id: 'EWJ', name: 'Japón', color: '#f59e0b' }
  ];

  // Rangos de tiempo
  const timeRanges = [
    { id: '1M', label: '1M' },
    { id: '3M', label: '3M' },
    { id: '6M', label: '6M' },
    { id: 'YTD', label: 'YTD' },
    { id: '1Y', label: '1Y' },
    { id: 'All', label: 'All' }
  ];

  // Simulación de datos (reemplazar con API real)
  useEffect(() => {
    setLoading(true);
    // Simular llamada a API
    setTimeout(() => {
      const mockData = generateMockData(timeRange);
      setData(mockData);
      setLoading(false);
    }, 800);
  }, [timeRange, activeIndices]);

  const generateMockData = (range) => {
    const points = range === '1M' ? 20 : range === '3M' ? 60 : range === '6M' ? 120 : range === 'YTD' ? 200 : range === '1Y' ? 250 : 500;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - points);

    return Array.from({ length: points }, (_, i) => {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      
      const baseValue = 100;
      const volatility = 15;
      
      return {
        date: date.toLocaleDateString('es-CL', { month: 'short', day: 'numeric' }),
        fullDate: date,
        SPY: baseValue + Math.sin(i / 10) * volatility + (i / 5) + Math.random() * 5,
        EWG: baseValue + Math.cos(i / 12) * (volatility * 0.8) + (i / 6) + Math.random() * 4,
        EWJ: baseValue + Math.sin(i / 8) * (volatility * 1.2) + (i / 7) + Math.random() * 6
      };
    });
  };

  const toggleIndex = (indexId) => {
    setActiveIndices(prev => 
      prev.includes(indexId) 
        ? prev.filter(id => id !== indexId)
        : [...prev, indexId]
    );
  };

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload) return null;

    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl">
        <p className="text-gray-400 text-xs mb-2">{payload[0]?.payload?.date}</p>
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center justify-between gap-4 mb-1">
            <span className="text-xs font-medium" style={{ color: entry.color }}>
              {entry.name}
            </span>
            <span className="text-xs font-bold text-white">
              {viewMode === 'Base100' 
                ? entry.value.toFixed(2) 
                : `${((entry.value - 100)).toFixed(2)}%`}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-gray-950 min-h-screen text-white p-6">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            Índices — SPY vs EWG vs EWJ — YTD (valores reales)
          </h1>
          <p className="text-gray-400 text-sm">
            S&P 500, Alemania, Japón · Formas superpuestas, ejes independientes
          </p>
        </div>

        {/* Controles de Índices */}
        <div className="flex flex-wrap gap-3 mb-4">
          {indices.map(index => (
            <button
              key={index.id}
              onClick={() => toggleIndex(index.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                activeIndices.includes(index.id)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {index.name}
            </button>
          ))}
        </div>

        {/* Controles de Tiempo */}
        <div className="flex flex-wrap gap-2 mb-4">
          {timeRanges.map(range => (
            <button
              key={range.id}
              onClick={() => setTimeRange(range.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                timeRange === range.id
                  ? 'bg-cyan-500 text-gray-900'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>

        {/* Controles de Vista */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setViewMode('Real')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              viewMode === 'Real'
                ? 'bg-emerald-500 text-gray-900'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Real
          </button>
          <button
            onClick={() => setViewMode('Base100')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              viewMode === 'Base100'
                ? 'bg-emerald-500 text-gray-900'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Base100
          </button>
          <button
            onClick={() => setViewMode('%')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              viewMode === '%'
                ? 'bg-emerald-500 text-gray-900'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            %
          </button>
        </div>

        {/* Gráfico */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          {loading ? (
            <div className="h-96 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-gray-400 text-sm">Cargando índices {timeRange}...</p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="date" 
                  stroke="#9ca3af"
                  style={{ fontSize: '12px' }}
                  tick={{ fill: '#9ca3af' }}
                />
                <YAxis 
                  stroke="#9ca3af"
                  style={{ fontSize: '12px' }}
                  tick={{ fill: '#9ca3af' }}
                  domain={['auto', 'auto']}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  wrapperStyle={{ paddingTop: '20px' }}
                  iconType="line"
                />
                {activeIndices.map(indexId => {
                  const index = indices.find(i => i.id === indexId);
                  return (
                    <Line
                      key={indexId}
                      type="monotone"
                      dataKey={indexId}
                      name={index.name}
                      stroke={index.color}
                      strokeWidth={2}
                      dot={false}
                      animationDuration={1000}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Footer con métricas */}
        <div className="mt-6 grid grid-cols-3 gap-4">
          {activeIndices.map(indexId => {
            const index = indices.find(i => i.id === indexId);
            const lastValue = data[data.length - 1]?.[indexId] || 100;
            const firstValue = data[0]?.[indexId] || 100;
            const change = ((lastValue - firstValue) / firstValue * 100).toFixed(2);
            
            return (
              <div key={indexId} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                <div className="flex items-center gap-2 mb-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: index.color }}
                  ></div>
                  <h3 className="font-semibold text-sm">{index.name}</h3>
                </div>
                <p className="text-2xl font-bold mb-1">{lastValue.toFixed(2)}</p>
                <p className={`text-sm ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {change >= 0 ? '+' : ''}{change}% {timeRange}
                </p>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
};

export default IndicesDashboard;
