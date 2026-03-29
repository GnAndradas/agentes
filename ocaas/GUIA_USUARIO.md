# OCAAS - Guia del Usuario

> Sistema de Administracion de Agentes con IA

---

## Que es OCAAS?

OCAAS es una plataforma que te permite gestionar un equipo de **agentes de inteligencia artificial** que pueden ejecutar tareas de forma autonoma o supervisada.

Piensa en OCAAS como un "jefe de proyecto" digital que:
- Recibe tareas y las analiza
- Asigna cada tarea al agente mas adecuado
- Puede subdividir tareas complejas automaticamente
- Genera nuevos agentes o herramientas cuando se necesitan
- Te mantiene informado de todo lo que pasa

---

## Conceptos Basicos

### Agentes

Los **agentes** son entidades de IA especializadas. Hay tres tipos:

| Tipo | Descripcion | Ejemplo |
|------|-------------|---------|
| **General** | Capaz de hacer multiples tipos de tareas | Un asistente versatil |
| **Specialist** | Experto en un area especifica | Agente de coding, testing |
| **Orchestrator** | Coordina a otros agentes | Gestor de proyectos |

Cada agente tiene **capacidades** que definen que puede hacer (ej: "coding", "testing", "research").

### Tareas

Las **tareas** son trabajos que quieres que los agentes realicen. Cada tarea tiene:
- **Titulo** y descripcion
- **Tipo** (coding, research, deployment, etc.)
- **Prioridad** (1=baja, 2=normal, 3=alta, 4=critica)
- **Estado** (pending, running, completed, failed)

### Skills

Los **skills** son instrucciones especializadas que los agentes pueden usar. Son como "manuales de procedimientos" escritos en texto que guian al agente.

### Tools

Los **tools** son herramientas ejecutables que los agentes pueden invocar. Por ejemplo: ejecutar tests, hacer deploy, enviar notificaciones.

---

## Como Usar OCAAS

### 1. Dashboard

La pagina principal muestra un resumen del sistema:

```
+------------------+-------------------+
|  Agentes Activos |  Tareas Pendientes|
|        3         |         5         |
+------------------+-------------------+
|       Skills     |       Tools       |
|        12        |         8         |
+------------------+-------------------+

[ Ultimos Eventos del Sistema ]
- Tarea "Deploy API" completada
- Agente "DevOps Bot" activado
- Nueva skill generada: "test-runner"
```

### 2. Gestionar Agentes

**Ver Agentes**: Menu lateral > "Agents"

Lista todos tus agentes con su estado actual:
- **Verde (Active)**: Disponible para recibir tareas
- **Azul (Busy)**: Ejecutando una tarea
- **Gris (Inactive)**: Desactivado
- **Rojo (Error)**: Problema detectado

**Acciones disponibles**:
- **Activar/Desactivar**: Controla si el agente puede recibir tareas
- **Editar**: Modifica nombre, descripcion, capacidades
- **Ver detalle**: Historial y configuracion completa

### 3. Crear Tareas

**Nueva Tarea**: Menu lateral > "Tasks" > Boton "New Task"

Completa el formulario:
```
Titulo: Implementar autenticacion OAuth
Descripcion: Agregar login con Google y GitHub al frontend
Tipo: coding
Prioridad: Alta (3)
```

Al crear la tarea, OCAAS automaticamente:
1. **Analiza** la tarea para entender que se necesita
2. **Busca** el mejor agente disponible
3. **Asigna** la tarea si hay agente adecuado
4. O **genera** los recursos necesarios si faltan

### 4. Seguimiento de Tareas

Cada tarea muestra su progreso en tiempo real:

```
Estado: running
Agente: coding-specialist-agent
Inicio: Hace 5 minutos
Reintentos: 0/3

[Ver Logs] [Cancelar]
```

**Subtareas**: Las tareas complejas se subdividen automaticamente:
```
Tarea Principal: "Implementar Dashboard"
  ├─ Subtarea 1: "Crear componente de graficos"     [completed]
  ├─ Subtarea 2: "Agregar filtros de fecha"         [running]
  └─ Subtarea 3: "Conectar con API de metricas"     [pending]
```

### 5. Generar Nuevos Recursos

**Generator**: Menu lateral > "Generator"

Puedes crear automaticamente:

**Nuevo Agente**:
```
Tipo: agent
Nombre: security-analyst
Descripcion: Agente especializado en analisis de seguridad
Prompt: Crea un agente que pueda escanear codigo en busca
        de vulnerabilidades, analizar dependencias y
        generar reportes de seguridad.
```

**Nuevo Skill**:
```
Tipo: skill
Nombre: code-review
Descripcion: Revision exhaustiva de codigo
Prompt: Crea un skill para revisar codigo que incluya
        verificacion de mejores practicas, performance
        y mantenibilidad.
```

**Nuevo Tool**:
```
Tipo: tool
Nombre: slack-notifier
Descripcion: Envia notificaciones a Slack
Prompt: Crea un tool que envie mensajes a un canal
        de Slack cuando se complete una tarea.
```

### 6. Aprobar Generaciones

Las generaciones requieren tu aprobacion antes de activarse.

**Generations**: Menu lateral > "Generations"

Cada generacion muestra:
- **Contenido generado**: El codigo o configuracion creado por la IA
- **Resultado de validacion**: Si la estructura es correcta
- **Acciones**: Aprobar o Rechazar

```
+----------------------------------------+
| Generacion: coding-assistant-agent     |
| Estado: pending_approval               |
+----------------------------------------+
| Contenido:                             |
| {                                      |
|   "name": "coding-assistant",          |
|   "type": "specialist",                |
|   "capabilities": ["coding", "review"] |
|   ...                                  |
| }                                      |
+----------------------------------------+
| [Aprobar]  [Rechazar]                  |
+----------------------------------------+
```

### 7. Configurar Autonomia

**Settings**: Menu lateral > "Settings"

Controla cuanta libertad tiene el sistema:

| Nivel | Comportamiento |
|-------|----------------|
| **Manual** | Todo requiere tu aprobacion |
| **Supervised** | Algunas acciones automaticas |
| **Autonomous** | El sistema decide todo |

Opciones adicionales:
- **Auto-aprobar generaciones**: Si/No
- **Timeout de aprobacion**: Tiempo antes de accion automatica
- **Accion por timeout**: Aprobar, Rechazar o Escalar

---

## Flujos de Trabajo Comunes

### Escenario 1: Tarea Simple

```
Tu: Creas tarea "Arreglar bug en login"
 ↓
OCAAS: Analiza → Encuentra agente con capability "coding"
 ↓
OCAAS: Asigna tarea a "coding-specialist"
 ↓
Agente: Ejecuta la tarea
 ↓
Tu: Recibes notificacion de tarea completada
```

### Escenario 2: Tarea Compleja

```
Tu: Creas tarea "Migrar base de datos a PostgreSQL"
 ↓
OCAAS: Analiza → Detecta complejidad alta
 ↓
OCAAS: Subdivide en 4 subtareas:
       1. Crear esquema nuevo
       2. Migrar datos
       3. Actualizar conexiones
       4. Verificar integridad
 ↓
OCAAS: Asigna subtareas a agentes disponibles
 ↓
OCAAS: Ejecuta en orden, respetando dependencias
 ↓
Tu: Tarea principal marcada como completada
```

### Escenario 3: Capacidad Faltante

```
Tu: Creas tarea "Escanear vulnerabilidades de seguridad"
 ↓
OCAAS: Analiza → Requiere capability "security"
 ↓
OCAAS: Busca → Ningun agente tiene esta capacidad
 ↓
OCAAS: Genera automaticamente un agente de seguridad
 ↓
Tu: Recibes solicitud de aprobacion (si no es autonomo)
 ↓
Tu: Apruebas la generacion
 ↓
OCAAS: Activa el nuevo agente y reintenta la tarea
```

---

## Barra de Estado

En la parte inferior de la pantalla ves:

```
[WS: Connected] [Gateway: Connected] [Orchestrator: Active]
```

- **WS (WebSocket)**: Conexion en tiempo real con el backend
- **Gateway**: Conexion con OpenClaw (ejecucion de agentes)
- **Orchestrator**: Estado del motor de orquestacion

Si algo esta desconectado, veras un indicador rojo.

---

## Preguntas Frecuentes

### Por que mi tarea esta en "pending"?

Posibles razones:
1. No hay agentes activos con las capacidades necesarias
2. El sistema esta generando un recurso nuevo
3. Hay una aprobacion pendiente

### Como veo que hizo un agente?

1. Ve a "Tasks" > click en la tarea
2. Mira el campo "Output" para ver el resultado
3. Los logs detallados estan en los eventos del sistema

### Puedo crear agentes manualmente?

Si, desde "Agents" > "New Agent". Pero es mas potente usar el Generator que crea agentes optimizados automaticamente.

### Que pasa si un agente falla?

1. La tarea se marca como "failed" con el error
2. Puedes ver el mensaje de error en el detalle
3. Usa el boton "Retry" para reintentar
4. La tarea tiene un maximo de 3 reintentos

### Como se priorizan las tareas?

1. **Prioridad**: Critica(4) > Alta(3) > Normal(2) > Baja(1)
2. Dentro de la misma prioridad: orden de creacion
3. Reintentos tienen prioridad sobre tareas nuevas

---

## Tips y Mejores Practicas

1. **Se especifico en las descripciones**: Cuanto mas claro seas, mejor el resultado

2. **Usa prioridades apropiadamente**: No marques todo como critico

3. **Revisa las generaciones**: Antes de aprobar, verifica que el contenido es correcto

4. **Empieza en modo supervisado**: Hasta que confies en el sistema, supervisa las acciones

5. **Monitorea el dashboard**: Te da vision rapida del estado del sistema

6. **Crea agentes especializados**: Es mejor varios especialistas que uno generalista

---

## Soporte

Si encuentras problemas:

1. Revisa los eventos del sistema en el Dashboard
2. Usa el healthcheck: `./scripts/healthcheck.sh`
3. Verifica que OpenClaw Gateway este activo
4. Revisa los logs en `logs/backend.log`

---

*OCAAS - Automatiza tu flujo de trabajo con inteligencia artificial*
