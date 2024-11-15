const express = require('express');
const mysql = require('mysql2/promise');
const passport = require('passport');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

// Crear la aplicación Express primero
const app = express();

// Configuración de middlewares
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(bodyParser.json());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'cliente')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Nueva ruta para archivos subidos con multer
 
app.use('/archivos', express.static(path.join('D:', 'DocumentosAIKOI'))); // Ruta pública para los archivos subidos

// Configuración de sesiones
app.use(session({
    secret: 'mysecret',
    resave: false,
    saveUninitialized: true,
    cookie: {
         secure: false,
         maxAge: 24 * 60 * 60 * 1000
        }
}));

app.use(passport.initialize());
app.use(passport.session());

// Importar configuración de Passport
require('./auth');

// Configuración de la conexión a MySQL usando pool en lugar de una única conexión
const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'usuarios',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Middleware para verificar si el usuario está logueado
function isLoggedIn(req, res, next) {
    req.user ? next() : res.sendStatus(401);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'D://DocumentosAIKOI');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
        const filename = `${uniqueSuffix}${path.extname(file.originalname)}`;
        cb(null, filename); // Solo guardamos el nombre del archivo
    }
});

const fileFilter = (req, file, cb) => {
    // Definir tipos de archivo permitidos para cada campo
    const allowedPdfTypes = ['application/pdf'];
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    
    // Verificar el tipo de archivo según el campo específico
    if (file.fieldname === 'fotoPerfil' && allowedImageTypes.includes(file.mimetype)) {
        cb(null, true);
    } else if (allowedPdfTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Tipo de archivo no soportado. Solo se permiten archivos PDF para documentos y formatos de imagen para la foto de perfil.'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB límite
    }
});


// Endpoint de registro mejorado con async/await y mejor manejo de errores
app.post('/registro', async (req, res) => {
    const { correo, contraseña } = req.body;

    try {
        // Validaciones
        if (!correo || !contraseña) {
            return res.status(400).json({ 
                success: false,
                message: 'Correo y contraseña son obligatorios' 
            });
        }

        // Verificar si el correo ya existe
        const [existingUsers] = await pool.execute(
            'SELECT * FROM beneficiario WHERE correo = ?',
            [correo]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'El correo ya está registrado'
            });
        }

        // Insertar nuevo usuario
        const [result] = await pool.execute(
            'INSERT INTO beneficiario (correo, contraseña) VALUES (?, ?)',
            [correo, contraseña]
        );

        res.status(201).json({
            success: true,
            message: 'Registro exitoso',
            userId: result.insertId
        });

    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Endpoint de login mejorado con async/await y mejor manejo de errores
app.post('/login', async (req, res) => {
    const { correo, contraseña } = req.body;

    try {
        // Verificar si es el administrador
        if (correo === 'administrador@gmail.com') {
            if (contraseña === 'FundacionAIKOI2024$') {
                return res.json({
                    success: true,
                    message: 'Login exitoso',
                    role: 'admin',
                    user: { correo, role: 'admin' }
                });
            }
            return res.status(401).json({
                success: false,
                message: 'Contraseña incorrecta'
            });
        }

        // Buscar usuario normal
        const [users] = await pool.execute(
            'SELECT id, correo FROM beneficiario WHERE correo = ? AND contraseña = ?',
            [correo, contraseña]
        );

        if (users.length > 0) {
            res.json({
                success: true,
                message: 'Login exitoso',
                role: 'beneficiario',
                user: {
                    id: users[0].id,
                    correo: users[0].correo,
                    role: 'beneficiario'
                }
            });
        } else {
            res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Rutas de autenticación con Google
app.get('/auth/google',
    passport.authenticate('google', { 
        scope: ['email', 'profile'],
        prompt: 'select_account' // Permite seleccionar cuenta siempre
    })
);

app.get('/auth/google/callback',
    passport.authenticate('google', {
        failureRedirect: '/auth/google/failure',
        failureMessage: true
    }),
    (req, res) => {
        try {
            // Verificar si la autenticación fue exitosa
            if (!req.user) {
                throw new Error('Autenticación fallida');
            }
            res.redirect('http://localhost:3000/Profile');
        } catch (error) {
            console.error('Error en callback de Google:', error);
            res.redirect('/auth/google/failure');
        }
    }
);

// Ruta protegida para datos del usuario
app.get('/auth/protected', isLoggedIn, (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Usuario no autenticado'
            });
        }

        const user = {
            displayName: req.user.displayName || 'Usuario sin nombre',
            email: req.user.emails?.[0]?.value || 'No email disponible',
            photo: req.user.photos?.[0]?.value || 'No photo available',
            googleId: req.user.id,
        };

        res.json({
            success: true,
            user
        });
    } catch (error) {
        console.error('Error al obtener datos protegidos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener datos del usuario'
        });
    }
});

// Ruta para actualizar foto de perfil
app.post('/auth/updateProfilePicture', 
    isLoggedIn, 
    upload.single('profilePicture'),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No se subió ninguna imagen'
                });
            }

            const newPhotoUrl = `http://localhost:5000/uploads/${req.file.filename}`;
            
            res.json({
                success: true,
                message: 'Foto de perfil actualizada exitosamente',
                user: {
                    ...req.user,
                    photo: newPhotoUrl
                }
            });
        } catch (error) {
            console.error('Error al actualizar foto de perfil:', error);
            res.status(500).json({
                success: false,
                message: 'Error al actualizar la foto de perfil'
            });
        }
    }
);

// Manejo de errores para multer
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'Archivo demasiado grande. Máximo 5MB permitido.'
            });
        }
        return res.status(400).json({
            success: false,
            message: 'Error al subir el archivo.'
        });
    }
    next(error);
});

// Ruta de fallo de autenticación
app.get('/auth/google/failure', (req, res) => {
    res.status(401).json({
        success: false,
        message: 'Falló la autenticación con Google'
    });
});

// Endpoint para cerrar sesión
app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: 'Error al cerrar sesión'
            });
        }
        res.json({
            success: true,
            message: 'Sesión cerrada exitosamente'
        });
    });
});


// Ruta para guardar datos de niños
app.post('/api/ninos', upload.fields([
    { name: 'informeMedico', maxCount: 1 },
    { name: 'historialMedico', maxCount: 1 },
    { name: 'certificadosTratamientosPaliativos', maxCount: 1 },
    { name: 'comprobanteDomicilio', maxCount: 1 },
    { name: 'curpDocumento', maxCount: 1 },
    { name: 'documentoIdentidad', maxCount: 1 },
    { name: 'declaracionImpuestos', maxCount: 1 },
    { name: 'comprobanteIngresos', maxCount: 1 },
    { name: 'cartaAntecedentesNoPenales', maxCount: 1 },
    { name: 'referenciasPersonalesProfesionales', maxCount: 1 },
    { name: 'fotoPerfil', maxCount: 1 }

]), async (req, res) => {
    const datos = req.body;
    const files = req.files;

    try {
        const beneficiarioId = Array.isArray(req.body.beneficiarioId) 
            ? parseInt(req.body.beneficiarioId[0], 10) 
            : parseInt(req.body.beneficiarioId, 10);

        console.log("ID del beneficiario recibido para pruebas:", beneficiarioId);

        // Verificar que el beneficiario existe
        const [beneficiario] = await pool.execute(
            'SELECT id FROM beneficiario WHERE id = ?',
            [beneficiarioId]
        );

        if (beneficiario.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Beneficiario no encontrado'
            });
        }

        // Verificar si ya existe un registro para este beneficiario
        const [existingRecord] = await pool.execute(
            'SELECT beneficiario_id FROM niños_etapa_terminal WHERE beneficiario_id = ?',
            [beneficiarioId]
        );

        if (existingRecord.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe un registro para este beneficiario'
            });
        }

    // Asignar las rutas de los archivos a las variables correspondientes
    const informeMedicoRuta = files?.informeMedico ? files.informeMedico[0].path : null;
    const historialMedicoRuta = files?.historialMedico ? files.historialMedico[0].path : null;
    const certificadosTratamientosRuta = files?.certificadosTratamientosPaliativos ? files.certificadosTratamientosPaliativos[0].path : null;
    const comprobanteDomicilioRuta = files?.comprobanteDomicilio ? files.comprobanteDomicilio[0].path : null;
    const curpDocumentoRuta = files?.curpDocumento ? files.curpDocumento[0].path : null;
    const documentoIdentidadRuta = files?.documentoIdentidad ? files.documentoIdentidad[0].path : null;
    const declaracionImpuestosRuta = files?.declaracionImpuestos ? files.declaracionImpuestos[0].path : null;
    const comprobanteIngresosRuta = files?.comprobanteIngresos ? files.comprobanteIngresos[0].path : null;
    const cartaAntecedentesNoPenalesRuta = files?.cartaAntecedentesNoPenales ? files.cartaAntecedentesNoPenales[0].path : null;
    const referenciasPersonalesProfesionalesRuta = files?.referenciasPersonalesProfesionales ? files.referenciasPersonalesProfesionales[0].path : null;
    const fotoPerfilRuta = files?.fotoPerfil ? files.fotoPerfil[0].path : null;

    // Consulta SQL con rutas de los archivos
    const sql = `
        INSERT INTO niños_etapa_terminal (
            beneficiario_id, nombre, apellido_paterno, apellido_materno, edad, sexo, fecha_nacimiento, curp, nivel_estudios,
            domicilio_calle_numero, colonia, municipio, estado, codigo_postal, referencia, telefono_fijo,
            telefono_fijo_extra, telefono_movil, telefono_movil_extra, servicios_vivienda, servicios_comunitarios,
            antecedentes_patologicos, servicios_salud, informe_medico, historial_medico, certificados_tratamientos_paliativos, descripcion_apoyo, 
            comprobante_domicilio, curp_documento, documento_identidad, declaracion_impuestos,
            comprobante_ingresos, carta_antecedentes_no_penales, referencias_personales_profesionales, foto_perfil
        )   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const valores = [
        beneficiarioId, 
        datos.nombre || null,
        datos.apellidoPaterno || null,
        datos.apellidoMaterno || null,
        datos.edad || null,
        datos.sexo || null,
        datos.fechaNacimiento || null,
        datos.curp || null,
        datos.nivelEstudios || null,
        datos.domicilio || null,
        datos.colonia || null,
        datos.municipio || null,
        datos.estado || null,
        datos.codigoPostal || null,
        datos.referencia || null,
        datos.telefonoFijo || null,
        datos.telefonoFijoExtra || null,
        datos.telefonoMovil || null,
        datos.telefonoMovilExtra || null,
        datos.serviciosVivienda || null,
        datos.serviciosComunitarios || null,
        datos.antecedentesPatologicos || null,  
        datos.serviciosSalud || null,           
        informeMedicoRuta,  // Ruta del archivo PDF
        historialMedicoRuta, 
        certificadosTratamientosRuta,  
        datos.descripcionApoyo || null,
        comprobanteDomicilioRuta,
        curpDocumentoRuta,
        documentoIdentidadRuta,
        declaracionImpuestosRuta,
        comprobanteIngresosRuta,
        cartaAntecedentesNoPenalesRuta,
        referenciasPersonalesProfesionalesRuta,
        fotoPerfilRuta,
    ];

    // Ejecutar la consulta
    const [result] = await pool.execute(sql, valores);

    res.status(201).json({
        success: true,
        message: 'Datos guardados correctamente',
        id: result.insertId
    });
} catch (error) {
    console.error('Error en el registro de niño:', error);
    res.json({ message: 'Datos procesados correctamente' });
    res.status(500).json({
        success: false,
        message: 'Error al guardar los datos',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
});

// Ruta para obtener todos los datos de la tabla niños_etapa_terminal
app.get('/api/ninos', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM niños_etapa_terminal');
      res.json(rows); // Enviar los datos en formato JSON
    } catch (error) {
      console.error('Error al obtener datos de niños:', error);
      res.status(500).json({ error: 'Error al obtener datos' });
    }
  });

// Ruta para obtener los datos de un niño específico
app.get('/api/ninos/:id', async (req, res) => {
    const { beneficiarioId } = req.params;
    try {
      const [rows] = await pool.query('SELECT * FROM niños_etapa_terminal WHERE beneficiario_id = ?', [beneficiarioId]);
      if (rows.length > 0) {
        res.json(rows[0]);
      } else {
        res.status(404).json({ error: 'Usuario no encontrado' });
      }
    } catch (error) {
      console.error('Error al obtener el usuario:', error);
      res.status(500).json({ error: 'Error al obtener el usuario' });
    }
  });
  

// Iniciar el servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});